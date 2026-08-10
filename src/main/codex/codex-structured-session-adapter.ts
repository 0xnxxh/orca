import type {
  AgentJournalMessageItem,
  AgentSessionJournalIdentity
} from '../../shared/agent-session-journal-types'
import type {
  AgentSessionAcquisition,
  AgentSessionDispatchOutcome,
  StructuredAgentSessionAdapter
} from '../native-chat/agent-session-wire/structured-agent-session-adapter'
import type { StructuredAgentSessionEventSink } from '../native-chat/agent-session-wire/structured-agent-session-event-sink'
import { createCodexJournalTranslator } from './codex-structured-journal-translation'
import {
  isCodexAppServerRequestError,
  openCodexAppServerConnection,
  type CodexAppServerServerRequest
} from './codex-app-server-connection'
import { isCodexAppServerUnsupportedError } from './codex-app-server-session'
import {
  CODEX_SPAWN_TOKEN_ENV,
  codexProcessIdentity,
  codexProviderHandleLink
} from './codex-structured-owner-identity'
import { answerCodexPrompt, receiveCodexPromptRequest } from './codex-structured-prompt-replies'
import { readCodexThreadId, readCodexTurnId } from './codex-structured-thread-facts'
import { openCodexThread } from './codex-structured-thread-open'
import { dispatchCodexTurn, isCodexTurnOptionKey } from './codex-structured-turn-start'
import { supportsCodexStructuredLocation } from './codex-structured-location-support'
import { closeCodexPublishedSession } from './codex-structured-session-close'
import {
  cancelCodexAcquisitionAttempt,
  createCodexAcquisitionAttempt,
  type CodexAcquisitionAttempt,
  type CodexSession,
  type CodexStructuredSessionAdapterDeps,
  type CodexStructuredSessionEvent
} from './codex-structured-session-state'

export type {
  CodexStructuredLaunch,
  CodexStructuredSessionAdapterDeps,
  CodexStructuredSessionEvent
} from './codex-structured-session-state'

// Owns one app-server child per structured Codex session; durable state stays on the wire.

export class CodexStructuredSessionAdapter implements StructuredAgentSessionAdapter {
  private readonly sessions = new Map<string, CodexSession>()
  private readonly acquiring = new Map<string, CodexAcquisitionAttempt>()

  constructor(private readonly deps: CodexStructuredSessionAdapterDeps) {}

  supportsLocation = supportsCodexStructuredLocation

  async acquire(input: {
    identity: AgentSessionJournalIdentity
    fence: number
    spawnToken: string
    events?: StructuredAgentSessionEventSink
  }): Promise<AgentSessionAcquisition> {
    const sessionId = input.identity.sessionId
    const previousAttempt = this.acquiring.get(sessionId)
    const attempt = createCodexAcquisitionAttempt()
    const acquisition = attempt.window
    this.acquiring.set(sessionId, attempt)
    let primaryThreadId =
      input.identity.providerHandle.kind === 'codex' ? input.identity.providerHandle.threadId : null
    const translator = input.events
      ? createCodexJournalTranslator({
          sink: input.events,
          primaryThreadId: () => primaryThreadId,
          bindPromptItemId: (journalItemId, threadId, promptKey) =>
            acquisition.prompts.bindJournalItemId(journalItemId, threadId, promptKey)
        })
      : null
    const open = this.deps.openConnection ?? openCodexAppServerConnection

    try {
      await cancelCodexAcquisitionAttempt(previousAttempt)
      await this.closePublishedSession(sessionId)
      if (attempt.cancelled || this.acquiring.get(sessionId) !== attempt) {
        throw new Error(`codex session ${sessionId} was superseded while being acquired`)
      }
      const launch = await this.deps.resolveLaunch({ identity: input.identity })
      if (attempt.cancelled || this.acquiring.get(sessionId) !== attempt) {
        throw new Error(`codex session ${sessionId} was superseded while being acquired`)
      }
      const connection = await open(
        {
          command: launch.command,
          args: launch.args,
          env: {
            [CODEX_SPAWN_TOKEN_ENV]: input.spawnToken,
            ...(launch.codexHome ? { CODEX_HOME: launch.codexHome } : {})
          }
        },
        {
          onNotification: (method, params) =>
            this.deliver(acquisition, sessionId, () =>
              this.handleNotification(sessionId, method, params)
            ),
          onServerRequest: (request) =>
            this.deliver(acquisition, sessionId, () =>
              this.handleServerRequest(sessionId, request)
            ),
          onExit: (error) => this.handleExit(sessionId, acquisition, error)
        }
      )
      acquisition.connection = connection
      const opened = await openCodexThread(connection, launch, this.deps.requestTimeoutMs)
      primaryThreadId = opened.threadId
      const acquired: AgentSessionAcquisition = {
        process: await codexProcessIdentity(
          { ...input, pid: connection.pid },
          this.deps.readProcessStartTime
        ),
        link: codexProviderHandleLink({
          threadId: opened.threadId,
          resumed: launch.resumeThreadId !== null,
          fence: input.fence,
          linkId: this.deps.mintLinkId?.(),
          observedAt: this.deps.now?.() ?? Date.now()
        })
      }
      // Publish only after every promised identity is proven and this attempt still owns the child.
      if (connection.closed) {
        throw new Error(`codex app-server for session ${sessionId} exited while being acquired`)
      }
      if (attempt.cancelled || this.acquiring.get(sessionId) !== attempt) {
        throw new Error(`codex session ${sessionId} was superseded while being acquired`)
      }
      this.acquiring.delete(sessionId)
      this.sessions.set(sessionId, {
        connection,
        threadId: opened.threadId,
        historyPath: opened.historyPath,
        prompts: acquisition.prompts,
        options: new Map(),
        turnIdWaiters: [],
        translator
      })
      for (const event of acquisition.drain()) {
        event()
      }
      return acquired
    } catch (error) {
      if (this.acquiring.get(sessionId) === attempt) {
        this.acquiring.delete(sessionId)
      }
      // Reap this attempt's child only. A replacement already published for the
      // same session keeps running.
      if (this.sessions.get(sessionId)?.connection !== acquisition.connection) {
        translator?.dispose()
        await acquisition.connection?.close()
      }
      throw error
    } finally {
      attempt.finish()
    }
  }

  /** Buffers pre-publication events and drops events from superseded children. */
  private deliver(
    acquisition: CodexAcquisitionAttempt['window'],
    sessionId: string,
    event: () => void
  ): void {
    if (acquisition.buffer(event)) {
      return
    }
    if (this.sessions.get(sessionId)?.connection === acquisition.connection) {
      event()
    }
  }

  /** Only the current connection may retire a session. */
  private handleExit(
    sessionId: string,
    acquisition: CodexAcquisitionAttempt['window'],
    error: Error
  ): void {
    acquisition.prompts.clear()
    const session = this.sessions.get(sessionId)
    if (!session || session.connection !== acquisition.connection) {
      return
    }
    this.sessions.delete(sessionId)
    this.emit(session, { type: 'ended', sessionId, reason: error.message })
    session.translator?.dispose()
  }

  private handleNotification(sessionId: string, method: string, params: unknown): void {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return
    }
    // A subagent runs on its own thread over the same connection: its turns must
    // not answer the root thread's waiter, and its events must carry the thread
    // they actually came from.
    const threadId = readCodexThreadId(params) ?? session.threadId
    if (method === 'turn/started' && threadId === session.threadId) {
      const turnId = readCodexTurnId(params)
      const waiter = turnId ? session.turnIdWaiters.shift() : undefined
      waiter?.(turnId as string)
    }
    this.emit(session, { type: 'notification', sessionId, threadId, method, params })
  }

  /** Journal first so observers never see an event ahead of its durable row. */
  private emit(session: CodexSession, event: CodexStructuredSessionEvent): void {
    session.translator?.handle(event)
    this.deps.onEvent?.(event)
  }

  private handleServerRequest(sessionId: string, request: CodexAppServerServerRequest): void {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return
    }
    const prompt = receiveCodexPromptRequest(session.prompts, session.connection, request)
    if (!prompt) {
      return
    }
    this.emit(session, {
      type: 'prompt',
      sessionId,
      threadId: prompt.threadId,
      method: request.method,
      params: request.params,
      codexItemId: prompt.codexItemId,
      promptKey: prompt.promptKey
    })
  }

  /** Lets the translation module address a live prompt by the journal item it
   *  became; until then the prompt key addresses it directly. */
  bindPromptItemId(sessionId: string, journalItemId: string, promptKey: string): void {
    const session = this.sessions.get(sessionId)
    session?.prompts.bindJournalItemId(journalItemId, session.threadId, promptKey)
  }

  async dispatch(input: {
    sessionId: string
    clientMessageId: string
    body: AgentJournalMessageItem
    fence: number
  }): Promise<AgentSessionDispatchOutcome> {
    return dispatchCodexTurn(this.session(input.sessionId), input, this.deps.requestTimeoutMs)
  }

  async cancelTurn(input: {
    sessionId: string
    turnId: string
    fence: number
  }): Promise<{ cancelled: boolean }> {
    const session = this.session(input.sessionId)
    try {
      await session.connection.request(
        'turn/interrupt',
        { threadId: session.threadId, turnId: input.turnId },
        { timeoutMs: this.deps.requestTimeoutMs }
      )
      return { cancelled: true }
    } catch (error) {
      // Codex declining names a turn it no longer owns; anything else leaves the
      // cancel unconfirmed and must surface as such.
      if (isCodexAppServerRequestError(error) || isCodexAppServerUnsupportedError(error)) {
        return { cancelled: false }
      }
      throw error
    }
  }

  async answerPrompt(input: {
    sessionId: string
    itemId: string
    kind: 'approval' | 'question'
    optionId: string
    fence: number
  }): Promise<void> {
    const session = this.session(input.sessionId)
    answerCodexPrompt(session.prompts, session.connection, input.itemId, input.optionId)
  }

  async setOption(input: {
    sessionId: string
    key: string
    value: string
    fence: number
  }): Promise<void> {
    const session = this.session(input.sessionId)
    if (!isCodexTurnOptionKey(input.key)) {
      throw new Error(`codex app-server has no thread option named ${input.key}`)
    }
    // Codex applies model, effort, and policy on `turn/start`, so an option set
    // between turns takes effect on the next one rather than immediately.
    session.options.set(input.key, input.value)
  }

  async historyFilePath(input: { identity: AgentSessionJournalIdentity }): Promise<string | null> {
    return this.sessions.get(input.identity.sessionId)?.historyPath ?? null
  }

  /** Reaps one session's child. The proven handle chain is already durable, so
   *  a graceful close loses nothing. */
  async closeSession(sessionId: string): Promise<void> {
    const attempt = this.acquiring.get(sessionId)
    if (attempt) {
      attempt.cancelled = true
      await attempt.window.connection?.close()
      await attempt.finished
    }
    await this.closePublishedSession(sessionId)
  }

  private async closePublishedSession(sessionId: string): Promise<void> {
    await closeCodexPublishedSession({
      sessions: this.sessions,
      sessionId,
      onEvent: this.deps.onEvent
    })
  }

  async closeAll(): Promise<void> {
    const sessionIds = new Set([...this.sessions.keys(), ...this.acquiring.keys()])
    await Promise.all([...sessionIds].map((sessionId) => this.closeSession(sessionId)))
  }

  releaseAcquisition(input: { sessionId: string }): Promise<void> {
    return this.closeSession(input.sessionId)
  }

  private session(sessionId: string): CodexSession {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(`no live codex app-server for session ${sessionId}`)
    }
    return session
  }
}
