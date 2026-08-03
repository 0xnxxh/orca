/**
 * Bounds the cost of back-pressuring a refused PTY projection.
 *
 * A projection is all-or-nothing, so one subscriber that never drains holds every PTY paused for every
 * viewer. Nothing else reaps such a sink: the writer only closes on a write *error*, and a peer that is
 * alive but not reading never raises one. This detaches a subscriber that made zero drain progress for a
 * full window — it reconnects and replays, while the sinks that are merely slow keep their back-pressure.
 */
export const PROJECTION_STALL_EVICTION_MS = 30_000

export type ProjectionStallProbe = {
  // Retaining producer bytes: the sink has accepted nothing back since they were queued.
  stalled: boolean
  // Monotonic settled bytes; unchanged across a window means the sink moved nothing at all.
  drainProgressBytes: number
}

export class ProjectionStallEvictor<T> {
  private readonly armed = new Map<T, number>()
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly probe: (target: T) => ProjectionStallProbe,
    private readonly evict: (target: T) => void,
    private readonly evictionMs: number = PROJECTION_STALL_EVICTION_MS
  ) {}

  noteRefusedProjection(targets: readonly T[]): void {
    for (const target of targets) {
      const probe = this.probe(target)
      if (!probe.stalled) {
        this.armed.delete(target)
        continue
      }
      if (!this.armed.has(target)) {
        this.armed.set(target, probe.drainProgressBytes)
      }
    }
    this.schedule()
  }

  forget(target: T): void {
    this.armed.delete(target)
  }

  dispose(): void {
    this.armed.clear()
    this.clearTimer()
  }

  private schedule(): void {
    if (this.timer || this.armed.size === 0) {
      return
    }
    this.timer = setTimeout(() => {
      this.timer = null
      this.sweep()
    }, this.evictionMs)
    this.timer.unref?.()
  }

  private clearTimer(): void {
    if (!this.timer) {
      return
    }
    clearTimeout(this.timer)
    this.timer = null
  }

  private sweep(): void {
    for (const [target, progressBytes] of Array.from(this.armed)) {
      const probe = this.probe(target)
      if (!probe.stalled) {
        this.armed.delete(target)
        continue
      }
      if (probe.drainProgressBytes !== progressBytes) {
        this.armed.set(target, probe.drainProgressBytes)
        continue
      }
      this.armed.delete(target)
      this.evict(target)
    }
    this.schedule()
  }
}
