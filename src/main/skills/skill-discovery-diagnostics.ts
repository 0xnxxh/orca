// Why: the searched roots have to be provable from a log, but a root's *label*
// carries a repo or plugin name and its path carries the user's directory names.
// Root ids are stable and already hashed for repo/plugin roots, so they identify
// the roots without publishing any of that.
const MAX_LOGGED_ROOT_IDS = 12

export type SkillDiscoveryDiagnostics = {
  /** Scan target kind, never a path: `native-host` or `wsl`. */
  target: string
  /** Ids of the roots that existed and were walked on this scan. */
  scannedRootIds: readonly string[]
  rootCount: number
  presentRootCount: number
  /** Roots answered from the coalescer instead of being walked again. */
  cachedRootCount: number
  skillCount: number
  durationMs: number
}

export function formatSkillDiscoveryDiagnostics(diagnostics: SkillDiscoveryDiagnostics): string {
  const ids = diagnostics.scannedRootIds.slice(0, MAX_LOGGED_ROOT_IDS)
  const overflow = diagnostics.scannedRootIds.length - ids.length
  const scanned = [...ids, ...(overflow > 0 ? [`+${overflow} more`] : [])].join(',')
  return `[skills] scan target=${diagnostics.target} roots=${diagnostics.rootCount} present=${diagnostics.presentRootCount} cached=${diagnostics.cachedRootCount} skills=${diagnostics.skillCount} ms=${diagnostics.durationMs}${scanned ? ` walked=${scanned}` : ''}`
}

export function logSkillDiscoveryDiagnostics(diagnostics: SkillDiscoveryDiagnostics): void {
  // Why: console.info is what Console.app / --enable-logging capture, which is
  // the only field visibility into a scan storm.
  console.info(formatSkillDiscoveryDiagnostics(diagnostics))
}
