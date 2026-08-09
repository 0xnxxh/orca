export class MobileSessionTabIntentTracker {
  worktreeId: string | null = null
  revision = 0
  fileTapActivationSeq = 0
  diffActivationSeq = 0
  pendingFocusKey: string | null = null
  private terminalCreateRevision = 0

  supersede(): number {
    this.revision += 1
    this.fileTapActivationSeq += 1
    this.diffActivationSeq += 1
    this.pendingFocusKey = null
    return this.revision
  }

  retryWhileCurrent(revision: number): () => boolean {
    return () => this.revision === revision
  }

  beginTerminalCreate(): number {
    return ++this.terminalCreateRevision
  }

  invalidateTerminalCreate(): void {
    this.terminalCreateRevision += 1
  }

  isTerminalCreateCurrent(worktreeId: string, revision: number): boolean {
    return this.worktreeId === worktreeId && this.terminalCreateRevision === revision
  }
}
