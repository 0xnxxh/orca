export class ClientSessionWorktreeAliases {
  private migratedWorktreeIds = new Map<string, string>()

  resolve(worktreeId: string): string {
    const migrated = this.migratedWorktreeIds.get(worktreeId)
    return migrated ? this.resolve(migrated) : worktreeId
  }

  migrate(
    oldPublishedWorktreeId: string,
    newWorktreeId: string
  ): { oldWorktreeId: string; newWorktreeId: string } {
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
