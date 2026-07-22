// Why: will-quit defers app.quit() until teardown settles. Teardown members
// are individually bounded, but a wedged transport (half-open post-sleep
// socket) can leave one unsettled forever and make Force Quit the only way
// out (#9447). Racing a deadline guarantees quit always completes.

// Why: generous enough for daemon checkpoint writes on a slow disk; small
// enough that a wedged teardown never needs Force Quit.
export const WILL_QUIT_TEARDOWN_DEADLINE_MS = 20_000

export function settleTeardownWithinDeadline(
  teardowns: Promise<unknown>[],
  deadlineMs: number = WILL_QUIT_TEARDOWN_DEADLINE_MS
): Promise<void> {
  const deadline = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, deadlineMs)
    if (typeof timer.unref === 'function') {
      timer.unref()
    }
  })
  return Promise.race([Promise.allSettled(teardowns).then(() => undefined), deadline])
}
