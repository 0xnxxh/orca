import type { ManagedPane } from '@/lib/pane-manager/pane-manager-types'
import { readProposedPaneFitDimensions } from '@/lib/pane-manager/pane-fit'

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
 * Why width-gated: an alt-screen frame is absolutely positioned. Replay pins
 * the terminal to the snapshot's grid (#7279) and the post-replay fit sizes the
 * pane back to its container, so a narrower target makes xterm's _reflowSmaller
 * split every frame row longer than the new width into a stray remainder row —
 * the garbled-on-reopen shape.
 *
 * Why only narrowing: _reflowLarger merely joins soft-wrapped lines, and a frame
 * row is not wrapped, so a wider target leaves it intact (just short of the
 * edge) — worth keeping over a blank screen. Scrollback is never dropped either
 * way: those rows are soft-wrapped, which is what reflow re-wraps correctly.
 */
/**
 * The column count the post-replay fit will land on. Why not terminal.cols: a
 * pane that has not been fitted yet still reads xterm's 80-column default, so
 * comparing against it would drop frames whose width actually matches the
 * container. Returns undefined when the pane cannot be measured; live callers
 * can clear and defer repaint, while cold/offline callers keep their frame.
 */
export function readProposedTerminalCols(pane: ManagedPane): number | undefined {
  return readProposedPaneFitDimensions(pane)?.cols
}

export function shouldSkipAltFrameForWidthMismatch(
  snapshotCols: number | undefined,
  targetCols: number | undefined,
  options: { skipIfTargetUnknown?: boolean } = {}
): boolean {
  const hasSnapshotWidth =
    typeof snapshotCols === 'number' && Number.isFinite(snapshotCols) && snapshotCols > 0
  if (!hasSnapshotWidth) {
    return false
  }
  const hasTargetWidth =
    typeof targetCols === 'number' && Number.isFinite(targetCols) && targetCols > 0
  if (!hasTargetWidth) {
    // A hidden pane has no final grid yet. A live app can repaint a cleared
    // screen after its deferred fit; painting first risks destructive reflow.
    return options.skipIfTargetUnknown === true
  }
  return (
    typeof snapshotCols === 'number' &&
    typeof targetCols === 'number' &&
    targetCols > 0 &&
    snapshotCols > targetCols
  )
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
