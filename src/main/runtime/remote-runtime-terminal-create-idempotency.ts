import type { RuntimeTerminalCreate } from '../../shared/runtime-types'

const DEFAULT_MAX_IN_FLIGHT_TERMINAL_CREATES = 4_096

export class RemoteRuntimeTerminalCreateIdempotency {
  private readonly inFlight = new Map<string, Promise<RuntimeTerminalCreate>>()
  // Why: a historical id can be reused by another live worktree, so rename lineage cannot be a global alias.
  private readonly identityWorktreeIdByCurrentId = new Map<string, string>()
  private readonly worktreeHistoryByCurrentId = new Map<string, ReadonlySet<string>>()

  constructor(private readonly maxInFlight = DEFAULT_MAX_IN_FLIGHT_TERMINAL_CREATES) {}

  resolveIdentityWorktreeId(worktreeId: string): string {
    return this.identityWorktreeIdByCurrentId.get(worktreeId) ?? worktreeId
  }

  includesWorktreeIdentity(currentWorktreeId: string, candidateWorktreeId: string): boolean {
    return (
      currentWorktreeId === candidateWorktreeId ||
      this.worktreeHistoryByCurrentId.get(currentWorktreeId)?.has(candidateWorktreeId) === true
    )
  }

  migrateWorktree(oldWorktreeId: string, newWorktreeId: string): void {
    if (oldWorktreeId === newWorktreeId) {
      return
    }
    const identityWorktreeId = this.resolveIdentityWorktreeId(oldWorktreeId)
    const history = new Set(this.worktreeHistoryByCurrentId.get(oldWorktreeId) ?? [oldWorktreeId])
    history.add(oldWorktreeId)
    history.add(newWorktreeId)
    this.identityWorktreeIdByCurrentId.delete(oldWorktreeId)
    this.identityWorktreeIdByCurrentId.delete(newWorktreeId)
    this.worktreeHistoryByCurrentId.delete(oldWorktreeId)
    this.worktreeHistoryByCurrentId.delete(newWorktreeId)
    if (identityWorktreeId !== newWorktreeId) {
      this.identityWorktreeIdByCurrentId.set(newWorktreeId, identityWorktreeId)
    }
    this.worktreeHistoryByCurrentId.set(newWorktreeId, history)
  }

  registerWorktreeHistory(worktreeId: string, priorWorktreeIds: readonly string[] = []): void {
    if (priorWorktreeIds.length === 0 && this.worktreeHistoryByCurrentId.has(worktreeId)) {
      return
    }
    const history = new Set([...priorWorktreeIds, worktreeId])
    const identityWorktreeId = priorWorktreeIds[0] ?? worktreeId
    if (identityWorktreeId === worktreeId) {
      this.identityWorktreeIdByCurrentId.delete(worktreeId)
    } else {
      this.identityWorktreeIdByCurrentId.set(worktreeId, identityWorktreeId)
    }
    this.worktreeHistoryByCurrentId.set(worktreeId, history)
  }

  run(
    clientIdentity: string,
    worktreeId: string,
    clientMutationId: string,
    create: () => Promise<RuntimeTerminalCreate>
  ): Promise<RuntimeTerminalCreate> {
    const identityWorktreeId = this.resolveIdentityWorktreeId(worktreeId)
    const key = `${clientIdentity}\0${identityWorktreeId}\0${clientMutationId}`
    const existing = this.inFlight.get(key)
    if (existing) {
      return existing
    }
    if (this.inFlight.size >= this.maxInFlight) {
      return Promise.reject(
        new Error('Too many terminal creations are still pending; retry after they settle.')
      )
    }

    const promise = create()
    this.inFlight.set(key, promise)
    const drop = (): void => {
      if (this.inFlight.get(key) === promise) {
        this.inFlight.delete(key)
      }
    }
    void promise.then(drop, drop)
    return promise
  }
}
