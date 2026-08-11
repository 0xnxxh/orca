import type { ManagedPane } from '@/lib/pane-manager/pane-manager-types'
import { readProposedPaneFitDimensions } from '@/lib/pane-manager/pane-fit'
import { isManagedPaneDisplayNone } from '@/lib/pane-manager/pane-display-visibility'

/**
 * Shared guards and write choreography for painting a main-model snapshot into
 * a (possibly fresh) xterm. One source for the reattach/hidden-restore paint
 * paths so their dimension guards and alt-screen branches cannot drift.
 */

/** True only for finite positive numeric cols/rows — Infinity/NaN/undefined
 *  from a malformed snapshot must degrade to "no resize", never reach
 *  terminal.resize(). */
export function hasPositiveTerminalDimensions(cols: unknown, rows: unknown): boolean {
  return (
    typeof cols === 'number' &&
    typeof rows === 'number' &&
    Number.isFinite(cols) &&
    Number.isFinite(rows) &&
    cols > 0 &&
    rows > 0
  )
}

/** Narrowing form of hasPositiveTerminalDimensions for optional-typed payloads. */
export function resolvePositiveTerminalDimensions(
  cols: unknown,
  rows: unknown
): { cols: number; rows: number } | null {
  return hasPositiveTerminalDimensions(cols, rows)
    ? { cols: cols as number, rows: rows as number }
    : null
}

/**
 * The column count the post-replay fit will land on. Why not terminal.cols: a
 * pane that has not been fitted yet still reads xterm's 80-column default, so
 * comparing against it would drop frames whose width actually matches the
 * container. Returns undefined when the pane cannot be measured; callers with
 * a repaint owner can clear and defer, while offline preconnect paint cannot.
 */
export function readProposedTerminalCols(pane: ManagedPane): number | undefined {
  return readProposedPaneFitDimensions(pane)?.cols
}

/**
 * Whether a withheld alt frame must be painted now, asked once the post-replay
 * fit has already failed to land.
 *
 * Why display:none rather than "is the target still unknown": the skip is a
 * deferral whose repaint rides that fit continuation, and only a hidden pane
 * still owes one — its continuation is parked for the reveal (which is also why
 * its completion resolves false immediately). A visible pane gets no second
 * chance, so a permanently unmeasurable one (display:none never applied, but a
 * box under the 48x24 fit floor: the divider clamp, a sliver from repeated
 * splits) would lose the frame forever.
 *
 * The width re-check keeps #13014: if the pane did become measurable and is
 * genuinely narrower than the capture grid, a later fit would clip the frame,
 * so leave it withheld.
 */
export function shouldRepaintDeferredAltFrame(
  pane: ManagedPane,
  snapshotCols: number | undefined
): boolean {
  if (isManagedPaneDisplayNone(pane)) {
    return false
  }
  return !shouldSkipAltFrameForWidthMismatch(snapshotCols, readProposedTerminalCols(pane))
}

export function shouldSkipAltFrameForWidthMismatch(
  snapshotCols: number | undefined,
  targetCols: number | undefined,
  options: { skipIfTargetUnknown?: boolean } = {}
): boolean {
  if (typeof snapshotCols !== 'number' || !Number.isFinite(snapshotCols) || snapshotCols <= 0) {
    return false
  }
  if (typeof targetCols !== 'number' || !Number.isFinite(targetCols) || targetCols <= 0) {
    // A hidden pane has no final grid; its live app can repaint after the deferred fit.
    return options.skipIfTargetUnknown === true
  }
  // Fixed-grid alt rows clip at narrower columns; normal history remains reflowable.
  return snapshotCols > targetCols
}

/**
 * Ordered replay writes for a main-model snapshot, including the alt-screen
 * choreography: main strips the `?1049h` marker when splitting scrollbackAnsi
 * from an alt frame, so the restorer owns the transition — rebuild the normal
 * buffer while on it, then paint the alt frame clean. Callers write these
 * before their post-replay reset/escape-tail sequences.
 *
 * `skipAltFrame` drops only the frame paint, never the buffer choreography or
 * scrollback or mode rehydration: the alt buffer is still entered and cleared
 * so the caller's SIGWINCH lands on a clean screen the application repaints.
 */
export function buildMainModelSnapshotReplayWrites(
  snapshot: {
    data: string
    /** Live state that can be restored without an alternate-screen frame. */
    frameRestoreAnsi?: string
    alternateScreen?: boolean
    scrollbackAnsi?: string
  },
  options: { skipAltFrame?: boolean } = {}
): string[] {
  if (!snapshot.alternateScreen) {
    // Why: \x1b[3J wipes xterm scrollback; safe here because a normal-buffer
    // snapshot carries its own history in data (mirrors pty-transport.ts).
    return ['\x1b[2J\x1b[3J\x1b[H', snapshot.data]
  }
  // Older snapshot producers do not expose the mode/frame boundary. Keep their
  // composed data rather than dropping terminal modes together with the frame.
  const altFrame =
    options.skipAltFrame && snapshot.frameRestoreAnsi !== undefined
      ? [snapshot.frameRestoreAnsi]
      : [snapshot.data]
  if (snapshot.scrollbackAnsi !== undefined) {
    // Why: main serializes normal + alt buffers separately; rebuild normal
    // while active, then return to a clean alt frame.
    return [
      '\x1b[?1049l\x1b[2J\x1b[3J\x1b[H',
      snapshot.scrollbackAnsi,
      '\x1b[0m\x1b[?1049h\x1b[2J\x1b[H',
      ...altFrame
    ]
  }
  // Why: the snapshot's ?1049h no-ops when already on alt screen and skips
  // blank cells; clear the alt buffer so the pre-hide frame can't bleed
  // through blank cells (spares normal-buffer scrollback).
  return ['\x1b[0m\x1b[?1049h\x1b[2J\x1b[H', ...altFrame]
}

/**
 * Paints a frame a previous skipAltFrame replay withheld, once it is known no
 * fit will move the grid off the capture grid. Only the alt-screen half: the
 * normal buffer and its scrollback were already rebuilt by that replay and must
 * not be replayed a second time.
 */
export function buildDeferredAltFrameReplayWrites(snapshot: { data: string }): string[] {
  return buildMainModelSnapshotReplayWrites({ data: snapshot.data, alternateScreen: true })
}
