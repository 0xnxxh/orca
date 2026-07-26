// Why this module exists: STA-2373 recovery replaces a dead daemon's shell with a
// fresh one, but the user is usually mid-line when the daemon dies. The keystrokes
// that raced the death are dropped, and everything typed after re-attach lands on
// the NEW shell — so the shell receives the *tail* of a line whose head no longer
// exists. Typing `echo hi; rm -rf x` and losing the head yields `cho hi; rm -rf x`,
// where zsh fails `cho` and then still runs `rm -rf x`, because `;` separates
// commands. Partially executing a command the user never completed is worse than
// dropping it, so quarantine input until the line boundary and start clean.
//
// State lives at module scope keyed by tabId, not in the pane closure: recovery
// remounts the pane, which builds a brand-new connection: closure state would be
// discarded exactly when the quarantine needs to apply.

// Why a cap: the release condition is the user's next Enter, which normally arrives
// within seconds. If they instead switch away mid-line and never submit, input must
// not stay dead — release on a timer so the worst case is bounded.
const QUARANTINE_MAX_MS = 15_000

type Quarantine = { armedAt: number }

const quarantineByTabId = new Map<string, Quarantine>()

function isLineBoundary(data: string): boolean {
  return data.includes('\r') || data.includes('\n')
}

/**
 * Arm after a dead-endpoint recovery so the fresh shell cannot receive the tail of
 * a line whose head was dropped. Idempotent: re-arming keeps the original deadline
 * so repeated signals for the same incident cannot extend the window indefinitely.
 */
export function armTerminalInputQuarantine(tabId: string, now = Date.now()): void {
  if (quarantineByTabId.has(tabId)) {
    return
  }
  quarantineByTabId.set(tabId, { armedAt: now })
}

/**
 * Returns true when this input must be dropped instead of reaching the shell.
 *
 * Consumes the quarantine on a line boundary (the Enter that would have submitted
 * the mangled line is itself swallowed, leaving the fresh shell at a clean prompt)
 * and on deadline expiry.
 */
export function shouldQuarantineTerminalInput(
  tabId: string,
  data: string,
  now = Date.now()
): boolean {
  const quarantine = quarantineByTabId.get(tabId)
  if (!quarantine) {
    return false
  }
  if (now - quarantine.armedAt >= QUARANTINE_MAX_MS) {
    quarantineByTabId.delete(tabId)
    return false
  }
  if (isLineBoundary(data)) {
    // Drop this one too: it is the submit for a line the shell never fully saw.
    quarantineByTabId.delete(tabId)
    return true
  }
  return true
}

export function isTerminalInputQuarantined(tabId: string): boolean {
  return quarantineByTabId.has(tabId)
}

export function releaseTerminalInputQuarantine(tabId: string): void {
  quarantineByTabId.delete(tabId)
}

export function _resetTerminalInputQuarantineForTests(): void {
  quarantineByTabId.clear()
}
