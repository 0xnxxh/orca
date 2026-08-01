export class RpcControlProbeFollowUp<T> {
  private active = false
  private queued: T | null = null

  constructor(
    private readonly getCurrentTarget: () => T | null,
    private readonly launch: (target: T) => void,
    private readonly onFinish: () => void = () => {}
  ) {}

  begin(target: T, queueAfterCurrent: boolean): boolean {
    if (!this.active) {
      this.active = true
      return true
    }
    if (queueAfterCurrent) {
      this.queued = target
    }
    return false
  }

  finish(target?: T): void {
    this.active = false
    this.onFinish()
    const queued = this.queued
    this.queued = null
    if (
      target !== undefined &&
      queued !== null &&
      queued === target &&
      this.getCurrentTarget() === queued
    ) {
      queueMicrotask(() => this.launch(queued))
    }
  }
}
