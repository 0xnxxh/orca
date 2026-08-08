export class SshPtyLiveMembership extends Set<string> {
  private revision = 0
  private readonly changedAtById = new Map<string, number>()

  override add(id: string): this {
    const alreadyPresent = this.has(id)
    super.add(id)
    if (!alreadyPresent) {
      this.recordChange(id)
    }
    return this
  }

  markLifecycleTransition(id: string): void {
    super.add(id)
    this.recordChange(id)
  }

  override delete(id: string): boolean {
    const deleted = super.delete(id)
    this.recordChange(id)
    return deleted
  }

  override clear(): void {
    for (const id of this) {
      this.recordChange(id)
    }
    super.clear()
  }

  captureRevision(): number {
    return this.revision
  }

  changedAfter(id: string, revision: number): boolean {
    return (this.changedAtById.get(id) ?? 0) > revision
  }

  private recordChange(id: string): void {
    this.revision += 1
    this.changedAtById.set(id, this.revision)
  }
}
