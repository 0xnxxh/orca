import type { ColdRestoreInfo } from './terminal-history-cold-restore-info'

// Why: #12101 — the recovered stream re-arms DECSET mouse reporting for a TUI
// that is provably dead (rehydrateSequences AND SerializeAddon's own mode
// trailer inside snapshotAnsi), so the replacement shell would echo SGR reports
// at the prompt. Seeding is the one place where "the process that armed this is
// gone" is an invariant, so live-TUI reattach keeps its mouse mode untouched.
// Mirrors the renderer's RESET_MOUSE_REPORTING (layout-serialization.ts).
const RESET_MOUSE_REPORTING = '\x1b[?9l\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?1016l'

export function getRecoveredHistorySeedSegments(restoreInfo: ColdRestoreInfo): readonly string[] {
  if (restoreInfo.modes.alternateScreen) {
    const normalBuffer = restoreInfo.scrollbackAnsi || restoreInfo.snapshotAnsi
    return normalBuffer ? [normalBuffer, RESET_MOUSE_REPORTING] : []
  }
  const recovered = [restoreInfo.rehydrateSequences, restoreInfo.snapshotAnsi].filter(
    (segment) => segment.length > 0
  )
  const escapeTail = restoreInfo.pendingEscapeTailAnsi
  // Why: an empty list is daemon-pty-adapter's "nothing to recover" sentinel (it gates
  // the probe-race respawn and the history re-anchor), so the reset must never pad it.
  if (recovered.length === 0 && !escapeTail) {
    return []
  }
  // Why after the snapshot: it must undo the snapshot's own mode trailer, and
  // pendingEscapeTailAnsi is a torn escape that has to stay at the very end.
  return [...recovered, RESET_MOUSE_REPORTING, ...(escapeTail ? [escapeTail] : [])]
}
