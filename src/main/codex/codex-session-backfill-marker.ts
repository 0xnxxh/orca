import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { writeFileAtomically } from '../codex-accounts/fs-utils'
import type { CodexSessionBackfillSummary } from './codex-session-backfill-types'

// Why: bump to re-run the backfill for every host after a layout or semantics
// change; the run itself stays skip-existing so re-runs never overwrite.
const CODEX_SESSION_BACKFILL_MARKER_VERSION = 3

export function hasCompletedCodexSessionBackfillMarker(
  markerPath: string,
  systemSessionsRoot: string,
  managedSessionsRoot: string
): boolean {
  try {
    const parsed: unknown = JSON.parse(readFileSync(markerPath, 'utf-8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return false
    }
    const marker = parsed as {
      version?: unknown
      systemSessionsRoot?: unknown
      summary?: { scannedFiles?: unknown }
    }
    // Why: changing the configured real Codex home must backfill the new
    // target instead of honoring a marker written for a different history.
    const markerMatchesTarget =
      marker.version === CODEX_SESSION_BACKFILL_MARKER_VERSION &&
      marker.systemSessionsRoot === systemSessionsRoot
    if (!markerMatchesTarget) {
      return false
    }
    // Why: an empty source can become populated after an early migration run.
    return marker.summary?.scannedFiles !== 0 || !managedSessionsRootHasRollout(managedSessionsRoot)
  } catch {
    return false
  }
}

function managedSessionsRootHasRollout(managedSessionsRoot: string): boolean {
  try {
    for (const year of readdirSync(managedSessionsRoot, { withFileTypes: true })) {
      if (!year.isDirectory() || !/^\d{4}$/.test(year.name)) {
        continue
      }
      const yearPath = join(managedSessionsRoot, year.name)
      for (const month of readdirSync(yearPath, { withFileTypes: true })) {
        if (!month.isDirectory() || !/^\d{2}$/.test(month.name)) {
          continue
        }
        const monthPath = join(yearPath, month.name)
        for (const day of readdirSync(monthPath, { withFileTypes: true })) {
          if (!day.isDirectory() || !/^\d{2}$/.test(day.name)) {
            continue
          }
          const dayPath = join(monthPath, day.name)
          if (
            readdirSync(dayPath, { withFileTypes: true }).some(
              (entry) => entry.isFile() && /^rollout-.+\.jsonl$/.test(entry.name)
            )
          ) {
            return true
          }
        }
      }
    }
    return false
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') {
      return false
    }
    throw error
  }
}

export function writeCodexSessionBackfillMarker(
  markerPath: string,
  systemSessionsRoot: string,
  summary: CodexSessionBackfillSummary
): void {
  mkdirSync(dirname(markerPath), { recursive: true })
  writeFileAtomically(
    markerPath,
    `${JSON.stringify(
      {
        version: CODEX_SESSION_BACKFILL_MARKER_VERSION,
        systemSessionsRoot,
        completedAt: Date.now(),
        summary
      },
      null,
      2
    )}\n`
  )
}

export function invalidateCodexSessionBackfillMarker(markerPath: string): void {
  try {
    // Why: a managed-lane system-default launch can create new source
    // rollouts, so a prior one-time marker must not suppress the next opt-in.
    rmSync(markerPath, { force: true })
  } catch (error) {
    console.warn('[codex-session-backfill] Failed to invalidate completion marker:', error)
  }
}
