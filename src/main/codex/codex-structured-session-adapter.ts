import type {
  AgentJournalMessageItem,
  AgentSessionJournalIdentity
} from '../../shared/agent-session-journal-types'
import type {
  AgentSessionAcquisition,
  AgentSessionDispatchOutcome,
  StructuredAgentSessionAdapter
} from '../native-chat/agent-session-wire/structured-agent-session-adapter'
import {
  isCodexAppServerRequestError,
  openCodexAppServerConnection,
  type CodexAppServerConnection,
  type CodexAppServerServerRequest
} from './codex-app-server-connection'
import { isCodexAppServerUnsupportedError } from './codex-app-server-session'
import {
  CODEX_SPAWN_TOKEN_ENV,
  codexProcessIdentity,
  codexProviderHandleLink
} from './codex-structured-owner-identity'
import {
  answerCodexPrompt,
  CodexPromptRegistry,
  receiveCodexPromptRequest
} from './codex-structured-prompt-replies'
import {
  readCodexThreadId,
  readCodexThreadPath,
  readCodexTurnId
} from './codex-structured-thread-facts'
import {
  CODEX_USER_MESSAGE_ORDINAL,
  isCodexTurnOptionKey,
  startCodexTurn
} from './codex-structured-turn-start'

// The Codex half of the structured agent-session wire: one long-lived
// `codex app-server` child per session, started or resumed under the lease the
// host already reserved. Everything durable — journal, fence, idempotency —
// belongs to the wire; this adapter only starts the process, names the turn the
// provider accepted, and answers Codex's blocking prompt requests.

export type CodexStructuredLaunch = {
  command: string
  args: string[]
  /** Thread working directory, passed to Codex rather than to the child. */
  cwd: string
  /** Pinned account home. Null inherits whatever CODEX_HOME the host has. */
  codexHome: string | null
  /** Thread this session already proved. Null starts a new one. Taken from the
   *  durable handle chain, never from the client-declared identity. */
  resumeThreadId: string | null
}

export type CodexStructuredSessionEvent =
  | { type: 'notification'; sessionId: string; threadId: string; method: string; params: unknown }
  | {
      type: 'prompt'
      sessionId: string
      threadId: string
      method: string
      params: unknown
      codexItemId: string
    }
  /** The child died without the host asking it to. The lease is now stale. */
  | { type: 'ended'; sessionId: string; reason: string }

export type CodexStructuredSessionAdapterDeps = {
  /** Command, args, cwd, and pinned home for one session. The wire's adapter
   *  contract carries none of these, so the runtime resolves them. */
  resolveLaunch: (input: {
    identity: AgentSessionJournalIdentity
  }) => Promise<CodexStructuredLaunch>
  /** Every Codex notification and prompt, in arrival order. The translation
   *  module subscribes here; without it the session still runs, unjournaled. */
  onEvent?: (event: CodexStructuredSessionEvent) => void
  openConnection?: typeof openCodexAppServerConnection
  readProcessStartTime?: (pid: number) => Promise<number | null>
  mintLinkId?: () => string
  now?: () => number
  requestTimeoutMs?: number
}

type CodexSession = {
  connection: CodexAppServerConnection
  threadId: string
  historyPath: string | null
  prompts: CodexPromptRegistry
  /** Applied to the next `turn/start`; Codex has no thread-settings write. */
  options: Map<string, string>
  turnIdWaiters: ((turnId: string) => void)[]
}

export class CodexStructuredSessionAdapter implements StructuredAgentSessionAdapter {
  private readonly sessions = new Map<string, CodexSession>()

  constructor(private readonly deps: CodexStructuredSessionAdapterDeps) {}

  private get requestTimeoutMs(): number | undefined {
    return this.deps.requestTimeoutMs
  }

  async acquire(input: {
    identity: AgentSessionJournalIdentity
    fence: number
    spawnToken: string
  }): Promise<AgentSessionAcquisition> {
    // A re-acquire at a new fence must not leave the old child writing.
    await this.closeSession(input.identity.sessionId)
    const sessionId = input.identity.sessionId
    const launch = await this.deps.resolveLaunch({ identity: input.identity })
    const prompts = new CodexPromptRegistry()
    const open = this.deps.openConnection ?? openCodexAppServerConnection
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
        onNotification: (method, params) => this.handleNotification(sessionId, method, params),
        onServerRequest: (request) => this.handleServerRequest(sessionId, request),
        onExit: (error) => {
          this.sessions.delete(sessionId)
          prompts.clear()
          this.deps.onEvent?.({ type: 'ended', sessionId, reason: error.message })
        }
      }
    )

    try {
      const started = await connection.request(
        launch.resumeThreadId ? 'thread/resume' : 'thread/start',
        launch.resumeThreadId
          ? { threadId: launch.resumeThreadId, cwd: launch.cwd }
          : { cwd: launch.cwd },
        { timeoutMs: this.requestTimeoutMs }
      )
      const threadId = readCodexThreadId(started)
      if (!threadId) {
        throw new Error('codex app-server did not name the thread it opened')
      }
      // A resume that lands on a different thread is a fork wearing a resume's
      // name; the handle chain would record a lie.
      if (launch.resumeThreadId && threadId !== launch.resumeThreadId) {
        throw new Error(`codex app-server resumed ${threadId} instead of ${launch.resumeThreadId}`)
      }
      this.sessions.set(sessionId, {
        connection,
        threadId,
        historyPath: readCodexThreadPath(started),
        prompts,
        options: new Map(),
        turnIdWaiters: []
      })
      return {
        process: await codexProcessIdentity(
          { ...input, pid: connection.pid },
          this.deps.readProcessStartTime
        ),
        link: codexProviderHandleLink({
          threadId,
          resumed: launch.resumeThreadId !== null,
          fence: input.fence,
          linkId: this.deps.mintLinkId?.(),
          observedAt: this.deps.now?.() ?? Date.now()
        })
      }
    } catch (error) {
      await connection.close()
      throw error
    }
  }

  private handleNotification(sessionId: string, method: string, params: unknown): void {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return
    }
    if (method === 'turn/started') {
      const turnId = readCodexTurnId(params)
      const waiter = turnId ? session.turnIdWaiters.shift() : undefined
      waiter?.(turnId as string)
    }
    this.deps.onEvent?.({
      type: 'notification',
      sessionId,
      threadId: session.threadId,
      method,
      params
    })
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
    this.deps.onEvent?.({
      type: 'prompt',
      sessionId,
      threadId: session.threadId,
      method: request.method,
      params: request.params,
      codexItemId: prompt.codexItemId
    })
  }

  /** Lets the translation module address a live prompt by the journal item it
   *  became; until then the Codex item id addresses it directly. */
  bindPromptItemId(sessionId: string, journalItemId: string, codexItemId: string): void {
    this.sessions.get(sessionId)?.prompts.bindJournalItemId(journalItemId, codexItemId)
  }

  async dispatch(input: {
    sessionId: string
    clientMessageId: string
    body: AgentJournalMessageItem
    fence: number
  }): Promise<AgentSessionDispatchOutcome> {
    const session = this.session(input.sessionId)
    let turnId: string | null
    try {
      turnId = await startCodexTurn(session, { ...input, timeoutMs: this.requestTimeoutMs })
    } catch (error) {
      // Codex answering and declining is a rejection; a timeout or a dead child
      // is not, and the wire must not tell the user their message failed.
      if (isCodexAppServerRequestError(error) || isCodexAppServerUnsupportedError(error)) {
        return { state: 'rejected', reason: (error as Error).message }
      }
      throw error
    }
    return turnId === null
      ? {
          state: 'unknown',
          reason: 'codex app-server started a turn it did not name in time'
        }
      : {
          state: 'accepted',
          providerIdentity: {
            provider: 'codex',
            threadId: session.threadId,
            turnId,
            ordinal: CODEX_USER_MESSAGE_ORDINAL
          }
        }
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
        { timeoutMs: this.requestTimeoutMs }
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
    const session = this.sessions.get(sessionId)
    if (!session) {
      return
    }
    this.sessions.delete(sessionId)
    session.prompts.clear()
    await session.connection.close()
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((sessionId) => this.closeSession(sessionId)))
  }

  private session(sessionId: string): CodexSession {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(`no live codex app-server for session ${sessionId}`)
    }
    return session
  }
}
