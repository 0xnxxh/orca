import type { TerminalKittyKeyboardModeTracker } from '../../../../shared/terminal-kitty-keyboard-mode-tracker'
import { parseTerminalKittyKeyboardFlags } from '../../../../shared/terminal-kitty-keyboard-flags'
import type {
  TerminalPreviewReplayChunk,
  TerminalPreviewSnapshot
} from '../../../../shared/terminal-preview'

/**
 * Apply snapshot + buffered replay, restoring proven kitty flags after the
 * snapshot scan (snapshot ANSI omits kitty pushes). Synchronous so no browser
 * event observes the temporary reset.
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
  // A constructor-fresh mirror carries nothing: its known-zero was
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
