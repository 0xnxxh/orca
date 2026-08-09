import type { RuntimeTerminalCreate } from '../../shared/runtime-types'
import { ClientSessionWorktreeAliases } from './client-session-worktree-aliases'

const DEFAULT_MAX_IN_FLIGHT_TERMINAL_CREATES = 4_096

export class RemoteRuntimeTerminalCreateIdempotency {
  private readonly inFlight = new Map<string, Promise<RuntimeTerminalCreate>>()
  private readonly worktreeAliases = new ClientSessionWorktreeAliases()
  private readonly identityWorktreeIdByCurrentId = new Map<string, string>()

  constructor(private readonly maxInFlight = DEFAULT_MAX_IN_FLIGHT_TERMINAL_CREATES) {}

  resolveCurrentWorktreeId(worktreeId: string): string {
    return this.worktreeAliases.resolve(worktreeId)
  }

  resolveIdentityWorktreeId(worktreeId: string): string {
    const currentWorktreeId = this.resolveCurrentWorktreeId(worktreeId)
    return this.identityWorktreeIdByCurrentId.get(currentWorktreeId) ?? currentWorktreeId
  }

  migrateWorktree(oldWorktreeId: string, newWorktreeId: string): void {
    const currentOldWorktreeId = this.resolveCurrentWorktreeId(oldWorktreeId)
    const identityWorktreeId = this.resolveIdentityWorktreeId(currentOldWorktreeId)
    const migration = this.worktreeAliases.migrate(oldWorktreeId, newWorktreeId)
    this.identityWorktreeIdByCurrentId.delete(migration.oldWorktreeId)
    this.identityWorktreeIdByCurrentId.delete(migration.newWorktreeId)
    if (identityWorktreeId !== migration.newWorktreeId) {
      this.identityWorktreeIdByCurrentId.set(migration.newWorktreeId, identityWorktreeId)
    }
  }

  registerWorktreeHistory(worktreeId: string, priorWorktreeIds: readonly string[] = []): void {
    const identities = [...priorWorktreeIds, worktreeId]
    for (let index = 1; index < identities.length; index += 1) {
      if (identities[index - 1] !== identities[index]) {
        this.migrateWorktree(identities[index - 1], identities[index])
      }
    }
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
