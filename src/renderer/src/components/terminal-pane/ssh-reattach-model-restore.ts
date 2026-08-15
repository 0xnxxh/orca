import { parseAppSshPtyId } from '../../../../shared/ssh-pty-id'

export type SshReattachPaintSource = 'main-model-snapshot' | 'relay-replay'

export type SshReattachModelSnapshot = {
  data: string
  source?: 'headless' | 'renderer'
  scrollbackAnsi?: string
  pendingEscapeTailAnsi?: string
}

// Why: relay replay is already available during reattach; a stalled model
// probe must not strand that fallback or hold live PTY bytes indefinitely.
export const SSH_REATTACH_MODEL_SNAPSHOT_TIMEOUT_MS = 750

export async function resolveSshReattachModelSnapshotWithTimeout<T>(
  snapshot: Promise<T>,
  timeoutMs = SSH_REATTACH_MODEL_SNAPSHOT_TIMEOUT_MS
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      snapshot.catch(() => null),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs)
      })
    ])
  } finally {
    if (timer !== null) {
      clearTimeout(timer)
    }
  }
}

/**
 * Which payload paints an SSH reattach. Only main's headless model is trusted: a
 * 'renderer'-sourced snapshot serializes a mounted xterm, which no longer exists
 * once the pane parked — anything but a non-empty headless snapshot degrades to
 * the relay replay, never a blank paint. Emptiness is judged on the composed
 * CONTENT (scrollback + screen): an alt-screen snapshot can carry all content in
 * scrollbackAnsi with an empty screen frame.
 *
 * Two situations trust the model, for the same underlying reason — the pane is
 * painting into a terminal that holds nothing:
 *
 * - PARKING (the original C1 gate), where the pane was unmounted on purpose.
 * - AN SSH RECONNECT, where a reconnect bumps tab.generation, which is the
 *   pane's React key, so TerminalPane remounts and the old xterm is disposed
 *   with its buffer.
 *
 * The reconnect case is not optional polish. Relay replay is a byte TAIL, and a
 * tail cannot reconstruct a full-screen application: it can begin mid-escape and
 * it misses the alt-screen enter, the clears and the absolute positioning that
 * built the frame. Replaying one paints fragments of a frame — which is what a
 * reconnected Claude Code showed until the user resized it. The model snapshot
 * is a serialized GRID, which is what tmux repaints on attach and the only
 * payload that restores a TUI correctly. Main keeps that model regardless of the
 * parking setting, so the reconnect case does not inherit its gate.
 */
export function decideSshReattachPaintSource(args: {
  ptyId: string
  sshParkingEnabled: boolean
  /** This mount replaces a terminal disposed by an SSH reconnect remount. */
  isSshReconnectRemount?: boolean
  snapshot: SshReattachModelSnapshot | null
}): SshReattachPaintSource {
  if (
    (!args.sshParkingEnabled && !args.isSshReconnectRemount) ||
    parseAppSshPtyId(args.ptyId) === null
  ) {
    return 'relay-replay'
  }
  if (!args.snapshot || args.snapshot.source !== 'headless') {
    return 'relay-replay'
  }
  // Why the escape tail is excluded: a dangling mid-escape is not content — a
  // model holding only one paints a blank pane, which this gate forbids.
  // Accepted cost: a session that wrote only control-sequence preamble before
  // parking always falls back to relay; the gate cannot tell it apart from a
  // model that never received content, and relay replays that preamble anyway.
  const contentLength = (args.snapshot.scrollbackAnsi?.length ?? 0) + args.snapshot.data.length
  return contentLength === 0 ? 'relay-replay' : 'main-model-snapshot'
}

/** Skip the snapshot fetch entirely when the paint could never use it. */
export function shouldFetchSshReattachModelSnapshot(args: {
  ptyId: string
  sshParkingEnabled: boolean
  isSshReconnectRemount?: boolean
}): boolean {
  return (
    (args.sshParkingEnabled || args.isSshReconnectRemount === true) &&
    parseAppSshPtyId(args.ptyId) !== null
  )
}

/**
 * Single-flight memo for the reattach model probe: at most one
 * getMainBufferSnapshot per reattach attempt. A null prefetch is remembered so
 * the payload task never buys a second probe timeout — it paints relay instead.
 */
export function memoizeSshReattachModelSnapshotProbe<T>(
  probe: () => Promise<T | null>
): () => Promise<T | null> {
  let inFlight: Promise<T | null> | null = null
  return () => {
    inFlight ??= probe()
    return inFlight
  }
}
