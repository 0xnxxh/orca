const PARKED_FULL_DEPTH_CAP_ENV_VAR = 'ORCA_DAEMON_PARKED_FULL_DEPTH_CAP'

/** Depth every attached and recently-parked session retains; matches HeadlessEmulator's default. */
export const DAEMON_SCROLLBACK_FULL_ROWS = 5000
// Why 1000: a trimmed parked session must still reattach with the recent command context on screen;
// this matches the snapshot depth Orca already accepts when rebuilding a terminal from persisted state.
export const DAEMON_SCROLLBACK_TRIMMED_PARKED_ROWS = 1000
// Why: retained grid is the daemon's dominant heap term and session count is unbounded — a host owning
// 100+ terminals retained ~1 GB of grid and was OOM-killed, taking every session it owned with it.
// Capping how many PARKED sessions keep full depth bounds memory without ever shallowing a terminal
// the user is looking at: attached sessions are exempt, and the cap evicts least-recently-viewed first.
export const DAEMON_PARKED_FULL_DEPTH_CAP = 24

function parseCapOverride(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined
  }
  const normalized = value.trim()
  if (!/^[1-9]\d*$/.test(normalized)) {
    return undefined
  }
  const parsed = Number(normalized)
  // The override may tighten the safety bound, never silently weaken it.
  if (!Number.isSafeInteger(parsed) || parsed > DAEMON_PARKED_FULL_DEPTH_CAP) {
    return undefined
  }
  return parsed
}

export function resolveParkedFullDepthCap(env: NodeJS.ProcessEnv = process.env): number {
  return parseCapOverride(env[PARKED_FULL_DEPTH_CAP_ENV_VAR]) ?? DAEMON_PARKED_FULL_DEPTH_CAP
}

export type SessionRetentionEntry = {
  sessionId: string
  /** A client is currently viewing this session; it must never be trimmed. */
  attached: boolean
  /** Monotonic view counter — higher means more recently attached. */
  recency: number
}

type RetainableSession = {
  hasAttachedClients: boolean
  setRetainedScrollbackRows(rows: number): void
}

/** Re-split retention across live sessions: full depth for attached and recently-viewed parked ones,
 *  trimmed depth for parked sessions past the LRU cap. Idempotent — unchanged depths are no-ops. */
export function applySessionScrollbackRetention(
  sessions: ReadonlyMap<string, RetainableSession>,
  recency: ReadonlyMap<string, number>,
  cap: number
): void {
  const entries = [...sessions.entries()].map(([sessionId, session]) => ({
    sessionId,
    attached: session.hasAttachedClients,
    recency: recency.get(sessionId) ?? 0
  }))
  const trimmed = new Set(selectParkedSessionsToTrim(entries, cap))
  for (const [sessionId, session] of sessions) {
    session.setRetainedScrollbackRows(
      trimmed.has(sessionId) ? DAEMON_SCROLLBACK_TRIMMED_PARKED_ROWS : DAEMON_SCROLLBACK_FULL_ROWS
    )
  }
}

/**
 * Parked sessions that must drop to the trimmed depth: everything past the `cap` most recently viewed.
 * Attached sessions never appear in the result and do not consume the cap. Pure so LRU ordering and
 * the attached exemption are unit-testable without a daemon.
 */
export function selectParkedSessionsToTrim(
  entries: readonly SessionRetentionEntry[],
  cap = DAEMON_PARKED_FULL_DEPTH_CAP
): string[] {
  return entries
    .filter((entry) => !entry.attached)
    .sort((a, b) => b.recency - a.recency)
    .slice(cap)
    .map((entry) => entry.sessionId)
}
