export class MobileSessionTabIntentTracker {
  revision = 0
  fileTapActivationSeq = 0
  diffActivationSeq = 0
  pendingFocusKey: string | null = null

  supersede(): number {
    this.revision += 1
    this.fileTapActivationSeq += 1
    this.diffActivationSeq += 1
    this.pendingFocusKey = null
    return this.revision
  }
}
