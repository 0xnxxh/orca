export const MAX_SSH_PTY_EXIT_TOMBSTONES = 1000

export class SshPtyLivenessState {
  readonly livePtyIds = new Set<string>()
  private readonly exitedPtyIds = new Set<string>()

  constructor(private readonly toAppPtyId: (id: string) => string) {}

  clear(): void {
    this.livePtyIds.clear()
    this.exitedPtyIds.clear()
  }

  probe(id: string): boolean | null {
    return this.livePtyIds.has(id) ? true : this.exitedPtyIds.has(id) ? false : null
  }

  acceptLive(id: string): void {
    const appPtyId = this.toAppPtyId(id)
    this.exitedPtyIds.delete(appPtyId)
    this.livePtyIds.add(appPtyId)
  }

  acceptUnverifiable(id: string): void {
    const appPtyId = this.toAppPtyId(id)
    this.livePtyIds.delete(appPtyId)
  }

  acceptExited(id: string): void {
    const appPtyId = this.toAppPtyId(id)
    this.livePtyIds.delete(appPtyId)
    this.exitedPtyIds.delete(appPtyId)
    this.exitedPtyIds.add(appPtyId)
    if (this.exitedPtyIds.size > MAX_SSH_PTY_EXIT_TOMBSTONES) {
      const oldest = this.exitedPtyIds.values().next().value
      if (oldest !== undefined) {
        this.exitedPtyIds.delete(oldest)
      }
    }
  }
}
