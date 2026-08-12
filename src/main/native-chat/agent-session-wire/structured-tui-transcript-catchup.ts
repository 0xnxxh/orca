import { join } from 'node:path'
import type { NativeChatMessage } from '../../../shared/native-chat-types'
import type { AgentSessionRecordStore } from '../../runtime/agent-session-record-store'
import { appendLegacyTranscriptMessages } from '../agent-session-journal/journal-legacy-import'
import { resolveSessionFilePath } from '../session-file-resolver'
import {
  subscribeNativeChatTranscript,
  type NativeChatTranscriptSubscription
} from '../transcript-watch'
import type { StructuredAgentSessionHostSession } from './structured-agent-session-host-types'

type CatchupState = {
  active: boolean
  fence: number
  providerSessionId: string
  pending: NativeChatMessage[]
  seen: Set<string>
  subscription: NativeChatTranscriptSubscription | null
}

export class StructuredTuiTranscriptCatchup {
  private readonly states = new Map<string, CatchupState>()

  constructor(
    private readonly input: {
      store: AgentSessionRecordStore
      session: (sessionId: string) => StructuredAgentSessionHostSession
      schedule: (sessionId: string, task: () => Promise<void>) => Promise<void>
      publish: (sessionId: string) => void
      onError?: (input: { sessionId: string; error: unknown }) => void
    }
  ) {}

  async prepare(sessionId: string, fence: number): Promise<void> {
    this.stop(sessionId)
    const record = this.input.store.getRecord(sessionId)
    const head = record?.providerHandleChain.at(-1)
    if (!record || head?.handle.provider !== 'codex') {
      return
    }
    const providerSessionId = head.handle.threadId
    const codexSessionsDirs = [join(record.accountHome.path, 'sessions')]
    const filePath = await resolveSessionFilePath('codex', providerSessionId, {
      codexSessionsDirs
    })
    let initialReady: (() => void) | null = null
    const ready = filePath ? new Promise<void>((resolve) => (initialReady = resolve)) : null
    const state: CatchupState = {
      active: false,
      fence,
      providerSessionId,
      pending: [],
      seen: new Set(),
      subscription: null
    }
    const receive = (messages: NativeChatMessage[]) => this.receive(sessionId, state, messages)
    this.states.set(sessionId, state)
    try {
      state.subscription = await subscribeNativeChatTranscript({
        agent: 'codex',
        sessionId: providerSessionId,
        codexSessionsDirs,
        ...(filePath ? { filePath, initialLimit: 0 } : {}),
        onInitialSnapshot: (messages) => {
          receive(messages)
          initialReady?.()
          initialReady = null
        },
        onAppend: receive
      })
      await ready
    } catch (error) {
      if (this.states.get(sessionId) === state) {
        this.states.delete(sessionId)
      }
      state.subscription?.unsubscribe()
      throw error
    }
  }

  async activate(sessionId: string): Promise<void> {
    const state = this.states.get(sessionId)
    if (!state) {
      return
    }
    state.active = true
    const pending = state.pending.splice(0)
    await this.append(sessionId, state, pending)
  }

  stop(sessionId: string): void {
    const state = this.states.get(sessionId)
    this.states.delete(sessionId)
    state?.subscription?.unsubscribe()
  }

  stopAll(): void {
    for (const sessionId of this.states.keys()) {
      this.stop(sessionId)
    }
  }

  private receive(sessionId: string, state: CatchupState, messages: NativeChatMessage[]): void {
    if (this.states.get(sessionId) !== state) {
      return
    }
    if (!state.active) {
      state.pending.push(...messages)
      return
    }
    void this.input
      .schedule(sessionId, () => this.append(sessionId, state, messages))
      .catch((error) => this.input.onError?.({ sessionId, error }))
  }

  private async append(
    sessionId: string,
    state: CatchupState,
    messages: NativeChatMessage[]
  ): Promise<void> {
    if (this.states.get(sessionId) !== state) {
      return
    }
    const record = this.input.store.getRecord(sessionId)
    if (
      !record ||
      record.lease.runtimeKind !== 'tui' ||
      record.lease.claimStatus !== 'live' ||
      record.lease.runtimeFence !== state.fence
    ) {
      return
    }
    const fresh = messages.filter((message) => !state.seen.has(message.id))
    if (fresh.length === 0) {
      return
    }
    try {
      await appendLegacyTranscriptMessages({
        journal: this.input.session(sessionId).journal,
        agent: 'codex',
        sessionId: state.providerSessionId,
        fence: state.fence,
        messages: fresh
      })
      for (const message of fresh) {
        state.seen.add(message.id)
      }
      this.input.publish(sessionId)
    } catch (error) {
      this.input.onError?.({ sessionId, error })
    }
  }
}
