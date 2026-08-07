import {
  AGENT_SESSION_STORE_SCHEMA_VERSION,
  agentSessionStoreRevision,
  loadAgentSessionStore,
  saveAgentSessionStore,
  type AgentSessionStoreState
} from './agent-session-record-store-file'
import { withAgentSessionStoreTransactionLock } from './agent-session-store-transaction-lock'

function markLoadedLeasesUnreconciled(state: AgentSessionStoreState): void {
  for (const [sessionId, record] of state.records) {
    state.records.set(sessionId, {
      ...record,
      lease: { ...record.lease, unreconciled: true }
    })
  }
}

export class AgentSessionStoreTransactionQueue {
  private queue: Promise<unknown> = Promise.resolve()
  private diskRecoveredFromBackup: boolean

  constructor(
    private readonly filePath: string,
    readonly hostId: string,
    readonly readOnly: boolean,
    readonly recoveredFromBackup: boolean,
    public state: AgentSessionStoreState,
    private diskRevision: string
  ) {
    this.diskRecoveredFromBackup = recoveredFromBackup
  }

  transact<T>(apply: () => T): Promise<T> {
    const run = this.queue.then(() =>
      withAgentSessionStoreTransactionLock(this.filePath, async () => {
        if (this.readOnly) {
          throw new Error('agent_session_legacy_required')
        }
        await this.refreshExternallyChangedState()
        const records = new Map(this.state.records)
        const operations = new Map(this.state.operations)
        const retiredClaimKeys = [...this.state.retiredClaimKeys]
        try {
          const result = apply()
          await saveAgentSessionStore(this.filePath, this.state, {
            recoveredFromBackup: this.diskRecoveredFromBackup
          })
          this.state.schemaVersion = AGENT_SESSION_STORE_SCHEMA_VERSION
          this.diskRevision = agentSessionStoreRevision(this.state)
          this.diskRecoveredFromBackup = false
          return result
        } catch (error) {
          this.state.records = records
          this.state.operations = operations
          this.state.retiredClaimKeys = retiredClaimKeys
          throw error
        }
      })
    )
    this.queue = run.catch(() => {})
    return run
  }

  private async refreshExternallyChangedState(): Promise<void> {
    const loaded = await loadAgentSessionStore(this.filePath, this.hostId)
    const diskRevision = agentSessionStoreRevision(loaded.state)
    this.diskRecoveredFromBackup = loaded.recoveredFromBackup
    if (diskRevision === this.diskRevision) {
      return
    }
    if (loaded.readOnly) {
      throw new Error('agent_session_legacy_required')
    }
    markLoadedLeasesUnreconciled(loaded.state)
    this.state = loaded.state
    this.diskRevision = diskRevision
  }
}

export function markAgentSessionStoreLeasesUnreconciled(state: AgentSessionStoreState): void {
  markLoadedLeasesUnreconciled(state)
}
