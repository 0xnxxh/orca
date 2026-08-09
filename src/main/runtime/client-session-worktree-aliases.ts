export class ClientSessionWorktreeAliases {
  private migratedWorktreeIds = new Map<string, string>()

  resolve(worktreeId: string): string {
    const migrated = this.migratedWorktreeIds.get(worktreeId)
    return migrated ? this.resolve(migrated) : worktreeId
  }

  private makeCanonical(worktreeId: string): void {
    const migrated = this.migratedWorktreeIds.get(worktreeId)
    if (!migrated) {
      return
    }
    const resolved = this.resolve(migrated)
    // Why: detaching a reused destination must not strand aliases that previously traversed it.
    const aliases = [...this.migratedWorktreeIds.keys()].filter(
      (alias) => alias !== worktreeId && this.resolve(alias) === resolved
    )
    this.migratedWorktreeIds.delete(worktreeId)
    for (const alias of aliases) {
      this.migratedWorktreeIds.set(alias, resolved)
    }
  }

  migrate(
    oldPublishedWorktreeId: string,
    newWorktreeId: string,
    resolveOldAlias = true
  ): { oldWorktreeId: string; newWorktreeId: string } {
    if (!resolveOldAlias) {
      this.makeCanonical(newWorktreeId)
      return { oldWorktreeId: oldPublishedWorktreeId, newWorktreeId }
    }
    const oldWorktreeId = this.resolve(oldPublishedWorktreeId)
    const aliases = [...this.migratedWorktreeIds.keys()].filter(
      (alias) => this.resolve(alias) === oldWorktreeId
    )
    // Why: a rename may reuse an earlier identity, which is canonical again rather than an alias.
    this.migratedWorktreeIds.delete(newWorktreeId)
    for (const alias of aliases) {
      if (alias !== newWorktreeId) {
        this.migratedWorktreeIds.set(alias, newWorktreeId)
      }
    }
    if (oldPublishedWorktreeId !== newWorktreeId) {
      this.migratedWorktreeIds.set(oldPublishedWorktreeId, newWorktreeId)
    }
    if (oldWorktreeId !== newWorktreeId) {
      this.migratedWorktreeIds.set(oldWorktreeId, newWorktreeId)
    }
    return { oldWorktreeId, newWorktreeId }
  }
}
