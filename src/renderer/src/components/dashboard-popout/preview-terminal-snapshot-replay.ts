import type { TerminalKittyKeyboardModeTracker } from '../../../../shared/terminal-kitty-keyboard-mode-tracker'
import { parseTerminalKittyKeyboardFlags } from '../../../../shared/terminal-kitty-keyboard-flags'
import type {
  TerminalPreviewReplayChunk,
  TerminalPreviewSnapshot
} from '../../../../shared/terminal-preview'

/**
 * Applies one preview connection — snapshot image plus its buffered replay — in
 * the order that keeps the kitty mirror authoritative (STA-3887):
 *
 * 1. reset to snapshot/unknown semantics, because production snapshot ANSI
 *    deliberately omits kitty pushes and so can never recover a negotiation
 *    that predates this capture;
 * 2. scan the snapshot's sections with replay semantics, so screen selection
 *    and any explicit mode bytes land first;
 * 3. adopt the flags the snapshot owner proved at this same boundary — or,
 *    when the owner proved nothing, the flags this mirror had already proven
 *    itself — onto whichever screen step 2 selected;
 * 4. scan each replay chunk with the mode main derived from its own sequence
 *    metadata — live only for a proven post-snapshot suffix.
 *
 * Synchronous by contract: no browser event may observe the temporary reset,
 * so callers must not await between these steps.
 */
export function replayPreviewConnectionSnapshot(args: {
  snapshot: TerminalPreviewSnapshot
  replay: TerminalPreviewReplayChunk[]
  kittyKeyboardModes: TerminalKittyKeyboardModeTracker
  /** Scans the chunk into the mirror and queues it for xterm. */
  write: (chunk: string, live: boolean) => void
}): void {
  const { snapshot, kittyKeyboardModes } = args
  // Why the carry: a resync snapshot from an owner that proves nothing (grid
  // change, capture overflow against an old host) must not erase what this
  // mirror already proved from live output — the pane's own snapshot policy
  // (STA-3887). A constructor-fresh mirror carries nothing: its known-zero was
  // never proven for the pre-existing PTY the preview attaches to.
  const provenFlags =
    parseTerminalKittyKeyboardFlags(snapshot.kittyKeyboardFlags) ??
    (kittyKeyboardModes.hasProvenBaseline ? kittyKeyboardModes.snapshotFlags : undefined)
  kittyKeyboardModes.resetForSnapshot()
  if (snapshot.scrollbackAnsi) {
    args.write(snapshot.scrollbackAnsi, false)
  }
  if (snapshot.data) {
    args.write(snapshot.data, false)
  }
  if (snapshot.pendingEscapeTailAnsi) {
    args.write(snapshot.pendingEscapeTailAnsi, false)
  }
  if (provenFlags !== undefined) {
    kittyKeyboardModes.restoreSnapshotFlags(provenFlags)
  }
  for (const chunk of args.replay) {
    args.write(chunk.data, chunk.mode === 'live')
  }
}
