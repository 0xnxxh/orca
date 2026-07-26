// Why this module exists: STA-2373 recovery replaces a dead daemon's shell with a
// fresh one, but the user is usually mid-line when the daemon dies. The keystrokes
// that raced the death are dropped, and everything typed after re-attach lands on
// the NEW shell — so the shell receives the *tail* of a line whose head no longer
// exists. Typing `echo hi; rm -rf x` and losing the head yields `cho hi; rm -rf x`,
// where zsh fails `cho` and then still runs `rm -rf x`, because `;` separates
// commands. Partially executing a command the user never completed is worse than
// dropping it, so quarantine input until the line boundary and start clean.
//
// State lives at module scope, not in the pane closure: recovery remounts the pane,
// which builds a brand-new connection, so closure state would be discarded exactly
// when the quarantine needs to apply.
//
// Keyed by ptyId, not tabId: split panes share a tab, and a tab-wide key would let
// Enter in one pane release its sibling — handing that sibling the mangled tail this
// exists to prevent, in precisely the multi-pane case STA-2373 was about. Session
// ids survive recovery (createOrAttach rebinds the same id), so a ptyId key still
// matches the pane after its remount.

// Why a cap: the release condition is the user's next Enter, which normally arrives
// within seconds. If they instead switch away mid-line and never submit, input must
// not stay dead — release on a timer so the worst case is bounded.
const QUARANTINE_MAX_MS = 15_000

type Quarantine = { armedAt: number; noticeShown: boolean }

const quarantineByPtyId = new Map<string, Quarantine>()

function isLineBoundary(data: string): boolean {
  return data.includes('\r') || data.includes('\n')
}

/**
 * Render a pane notice: an inverse-video gutter marker followed by the message.
 *
 * Inverse video rather than a colour so it stays legible against every theme and any
 * shell palette, and reads as the app speaking rather than as shell output.
 */
export function formatTerminalPaneNotice(message: string): string {
  return `\r\n[0m[7m * [0m ${message}[0m\r\n`
}

/**
 * Arm after a dead-endpoint recovery so the fresh shell cannot receive the tail of
 * a line whose head was dropped. Idempotent: re-arming keeps the original deadline
 * so repeated signals for the same incident cannot extend the window indefinitely.
 */
export function armTerminalInputQuarantine(ptyId: string, now = Date.now()): void {
  if (quarantineByPtyId.has(ptyId)) {
    return
  }
  quarantineByPtyId.set(ptyId, { armedAt: now, noticeShown: false })
}

/**
 * Returns true when this input must be dropped instead of reaching the shell.
 *
 * Consumes the quarantine on a line boundary (the Enter that would have submitted
 * the mangled line is itself swallowed, leaving the fresh shell at a clean prompt)
 * and on deadline expiry.
 */
export function shouldQuarantineTerminalInput(
  ptyId: string,
  data: string,
  now = Date.now()
): boolean {
  const quarantine = quarantineByPtyId.get(ptyId)
  if (!quarantine) {
    return false
  }
  if (now - quarantine.armedAt >= QUARANTINE_MAX_MS) {
    quarantineByPtyId.delete(ptyId)
    return false
  }
  if (isLineBoundary(data)) {
    // Drop this one too: it is the submit for a line the shell never fully saw.
    quarantineByPtyId.delete(ptyId)
    return true
  }
  return true
}

/**
 * True once per quarantine, for the caller that should print the notice.
 *
 * Deferred to the first dropped keystroke rather than shown at reconnect: that is
 * the moment the pane stops echoing, so it explains the silence exactly when the
 * user meets it, and it needs no hook into the replay pipeline that would otherwise
 * have to paint after a restore without being overwritten by it.
 */
export function consumeTerminalInputQuarantineNotice(ptyId: string): boolean {
  const quarantine = quarantineByPtyId.get(ptyId)
  if (!quarantine || quarantine.noticeShown) {
    return false
  }
  quarantine.noticeShown = true
  return true
}

export function isTerminalInputQuarantined(ptyId: string): boolean {
  return quarantineByPtyId.has(ptyId)
}

export function releaseTerminalInputQuarantine(ptyId: string): void {
  quarantineByPtyId.delete(ptyId)
}

export function _resetTerminalInputQuarantineForTests(): void {
  quarantineByPtyId.clear()
}
