import { randomUUID } from 'node:crypto'
import type { AgentSessionWireRefusal } from '../../../shared/agent-session-wire'
import type { AgentSessionRecordStore } from '../../runtime/agent-session-record-store'
import type { AgentSessionAttachParams } from './structured-agent-session-attach'
import type { RestoredStructuredAgentSessionRead } from './structured-agent-session-read-restore'
import { restoreStructuredAgentSessionsOnRestart } from './structured-agent-session-restart-restore'

export class StructuredAgentSessionReadableRestorer {
  private restorePromise: Promise<void> | null = null

  constructor(
    private readonly input: {
      store: AgentSessionRecordStore
      journalRoot: string
      reconcile: (sessionId: string) => Promise<AgentSessionWireRefusal | null>
      resume: (params: AgentSessionAttachParams) => Promise<boolean>
      serialize: <T>(sessionId: string, task: () => Promise<T>) => Promise<T>
      hasSession: (sessionId: string) => boolean
      onReadable: (sessionId: string, restored: RestoredStructuredAgentSessionRead) => void
      restoreHandoff: (sessionId: string) => Promise<void>
      now: () => number
    }
  ) {}

  restore(): Promise<void> {
    this.restorePromise ??= restoreStructuredAgentSessionsOnRestart({
      ...this.input,
      records: this.input.store.listRecords().filter((record) => record.provider === 'codex'),
      operationId: () =>
        `${Math.trunc(this.input.now()).toString().padStart(13, '0')}-${randomUUID().replaceAll('-', '')}`
    }).catch((error) => {
      this.restorePromise = null
      throw error
    })
    return this.restorePromise
  }
}
