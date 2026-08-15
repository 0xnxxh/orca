import type { SubprocessHandle } from './session-subprocess-handle'

// Why: pause is a fire-and-forget notify, so a resume can be lost (main crash, dropped socket); a lost
// resume must never wedge a shell, so auto-resume after this window — a still-flooded main re-pauses.
export const PRODUCER_PAUSE_FAILSAFE_MS = 5_000

/** Producer-side flow control over one PTY handle: stop reading the fd so a flooding child blocks
 *  on write, backed by the lost-resume failsafe timer. */
export class ProducerPauseController {
  private producerPaused = false
  private producerPauseFailsafeTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly subprocess: Pick<SubprocessHandle, 'pause' | 'resume'>) {}

  /** Arms the lost-resume failsafe; re-pausing re-arms it. */
  pause(): void {
    this.producerPaused = true
    this.subprocess.pause?.()
    if (this.producerPauseFailsafeTimer) {
      clearTimeout(this.producerPauseFailsafeTimer)
    }
    this.producerPauseFailsafeTimer = setTimeout(() => {
      this.producerPauseFailsafeTimer = null
      this.producerPaused = false
      this.subprocess.resume?.()
    }, PRODUCER_PAUSE_FAILSAFE_MS)
  }

  release(opts: { resume: boolean }): void {
    if (this.producerPauseFailsafeTimer) {
      clearTimeout(this.producerPauseFailsafeTimer)
      this.producerPauseFailsafeTimer = null
    }
    if (!this.producerPaused) {
      return
    }
    this.producerPaused = false
    if (opts.resume) {
      this.subprocess.resume?.()
    }
  }
}
