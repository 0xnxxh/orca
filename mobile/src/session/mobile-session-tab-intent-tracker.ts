export type MobileSessionTabCreateKind = 'terminal' | 'browser' | 'markdown'

export class MobileSessionTabIntentTracker {
  hostId: string | null = null
  worktreeId: string | null = null
  revision = 0
  fileTapActivationSeq = 0
  diffActivationSeq = 0
  pendingFocusKey: string | null = null
  private routeRevision = 0
  private tabCreateRevisions: Record<MobileSessionTabCreateKind, number> = {
    terminal: 0,
    browser: 0,
    markdown: 0
  }

  supersede(): number {
    this.revision += 1
    this.fileTapActivationSeq += 1
    this.diffActivationSeq += 1
    this.pendingFocusKey = null
    return this.revision
  }

  setRoute(hostId: string, worktreeId: string): void {
    if (this.isRouteCurrent(hostId, worktreeId)) {
      return
    }
    this.hostId = hostId
    this.worktreeId = worktreeId
    this.routeRevision += 1
    this.supersede()
  }

  captureRouteOwnership(hostId: string, worktreeId: string): () => boolean {
    const routeRevision = this.routeRevision
    return () => this.routeRevision === routeRevision && this.isRouteCurrent(hostId, worktreeId)
  }

  retryWhileCurrent(revision: number): () => boolean {
    return () => this.revision === revision
  }

  pendingActivationKey(tab: { id: string; leafId?: string }): string {
    return JSON.stringify([this.hostId, this.worktreeId, tab.id, tab.leafId ?? ''])
  }

  beginTabCreate(kind: MobileSessionTabCreateKind): number {
    return ++this.tabCreateRevisions[kind]
  }

  invalidateTabCreates(): void {
    for (const kind of Object.keys(this.tabCreateRevisions) as MobileSessionTabCreateKind[]) {
      this.tabCreateRevisions[kind] += 1
    }
  }

  isRouteCurrent(hostId: string, worktreeId: string): boolean {
    return this.hostId === hostId && this.worktreeId === worktreeId
  }

  isTabCreateCurrent(
    hostId: string,
    worktreeId: string,
    kind: MobileSessionTabCreateKind,
    revision: number
  ): boolean {
    return this.isRouteCurrent(hostId, worktreeId) && this.tabCreateRevisions[kind] === revision
  }
}
