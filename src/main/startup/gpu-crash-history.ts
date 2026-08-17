import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  durableWriteTempPath,
  removeStaleDurableWriteTempFiles,
  writeFileDurableSync
} from '../durable-file-write'
import type { GpuFallbackEnvironment, WindowsGpuFallbackEnvironment } from './gpu-fallback-marker'

/**
 * Persisted GPU-crash evidence, sibling of gpu-fallback.json.
 *
 * Why a second file: the marker is the *decision* (software rendering is on for
 * this build), this is the *evidence* that justifies making it. The crash-at-
 * startup shape kills the process ~600ms in, so the in-memory
 * GpuCrashFallbackTracker never reaches its threshold and the marker was
 * structurally unwritable — every launch crashed exactly once and forgot.
 * Merging the two files would make version-invalidation mean two things at once.
 */

export const GPU_CRASH_HISTORY_FILE = 'gpu-crash-history.json'
export const GPU_CRASH_HISTORY_SCHEME_VERSION = 1

/** Distinct launches retained; one entry per launch, so the file stays a fixed small size. */
export const GPU_CRASH_HISTORY_MAX_ENTRIES = 8
/** Wall-clock horizon: crashes older than this are not evidence about today's driver. */
export const GPU_CRASH_HISTORY_HORIZON_MS = 600_000
/** Only crashes this early in a launch mean "cannot even boot". */
export const GPU_CRASH_STARTUP_WINDOW_MS = 15_000
/** Distinct crashing launches inside the horizon that engage software rendering. */
export const CROSS_LAUNCH_GPU_FALLBACK_THRESHOLD = 3
/**
 * Threshold once a *previous* build already fell back: that build's evidence is
 * gone with the update, so the full threshold would cost a chronically broken
 * machine three unbootable launches per release. One fresh hardware attempt is
 * kept — the update may be the fix — and the second startup crash re-engages.
 */
export const CROSS_LAUNCH_GPU_FALLBACK_THRESHOLD_AFTER_UPDATE = 1

export type GpuCrashHistoryEntry = {
  atEpochMs: number
  msSinceLaunch: number
  launchId: string
}

type GpuCrashHistory = {
  schemeVersion: number
  appVersion: string
  electronVersion: string
  platform: 'win32'
  crashes: GpuCrashHistoryEntry[]
}

function historyPath(userDataPath: string): string {
  return join(userDataPath, GPU_CRASH_HISTORY_FILE)
}

function parseEntry(value: unknown): GpuCrashHistoryEntry | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const entry = value as Partial<Record<keyof GpuCrashHistoryEntry, unknown>>
  if (
    typeof entry.atEpochMs !== 'number' ||
    !Number.isFinite(entry.atEpochMs) ||
    typeof entry.msSinceLaunch !== 'number' ||
    !Number.isFinite(entry.msSinceLaunch) ||
    entry.msSinceLaunch < 0 ||
    typeof entry.launchId !== 'string' ||
    entry.launchId.length === 0
  ) {
    return null
  }
  return {
    atEpochMs: entry.atEpochMs,
    msSinceLaunch: entry.msSinceLaunch,
    launchId: entry.launchId
  }
}

function readGpuCrashHistory(userDataPath: string): GpuCrashHistory | null {
  try {
    const parsed = JSON.parse(readFileSync(historyPath(userDataPath), 'utf-8')) as Partial<
      Record<keyof GpuCrashHistory, unknown>
    >
    if (parsed.schemeVersion !== GPU_CRASH_HISTORY_SCHEME_VERSION) {
      return null
    }
    if (
      typeof parsed.appVersion !== 'string' ||
      typeof parsed.electronVersion !== 'string' ||
      parsed.platform !== 'win32' ||
      !Array.isArray(parsed.crashes)
    ) {
      return null
    }
    return {
      schemeVersion: GPU_CRASH_HISTORY_SCHEME_VERSION,
      appVersion: parsed.appVersion,
      electronVersion: parsed.electronVersion,
      platform: parsed.platform,
      // Why: a truncated write can leave one unreadable entry; the rest is still evidence.
      crashes: parsed.crashes
        .map(parseEntry)
        .filter((entry): entry is GpuCrashHistoryEntry => entry !== null)
    }
  } catch {
    // missing or corrupt means no evidence
  }
  return null
}

export function clearGpuCrashHistory(userDataPath: string): void {
  try {
    rmSync(historyPath(userDataPath), { force: true })
  } catch {
    // best effort; stale evidence ages out of the horizon anyway
  }
}

/**
 * Crash history recorded by this exact build, or an empty list. Mirrors
 * readActiveGpuFallbackMarker: evidence from another app/Electron build says
 * nothing about this one, so the file is discarded rather than carried forward.
 */
export function readActiveGpuCrashHistory(
  userDataPath: string,
  environment: GpuFallbackEnvironment
): readonly GpuCrashHistoryEntry[] {
  const history = readGpuCrashHistory(userDataPath)
  if (!history) {
    if (existsSync(historyPath(userDataPath))) {
      clearGpuCrashHistory(userDataPath)
    }
    return []
  }
  if (
    environment.platform !== 'win32' ||
    history.platform !== environment.platform ||
    history.appVersion !== environment.appVersion ||
    history.electronVersion !== environment.electronVersion
  ) {
    clearGpuCrashHistory(userDataPath)
    return []
  }
  return history.crashes
}

/**
 * Durable (fsync + rename) because the caller is a process Chromium may FATAL
 * milliseconds later: a torn or zero-length file destroys every earlier launch's
 * evidence, not just this entry.
 */
function writeGpuCrashHistory(userDataPath: string, history: GpuCrashHistory): void {
  const target = historyPath(userDataPath)
  const temp = durableWriteTempPath(target)
  try {
    writeFileDurableSync(temp, target, JSON.stringify(history))
  } catch (error) {
    try {
      rmSync(temp, { force: true })
    } catch {
      // sweepOrphanedGpuCrashHistoryWrites reclaims it later
    }
    throw error
  }
}

/**
 * Reclaims temp files orphaned by a death between write and rename. This is the
 * one machine class where that death is routine, and the temp name carries the
 * pid, so without a sweep the orphans accumulate under distinct names forever.
 */
export function sweepOrphanedGpuCrashHistoryWrites(userDataPath: string): void {
  void removeStaleDurableWriteTempFiles(historyPath(userDataPath), {
    minimumAgeMs: GPU_CRASH_HISTORY_HORIZON_MS
  }).catch(() => {
    // best effort; an orphaned temp file costs a few bytes
  })
}

/**
 * Records one crashing launch.
 *
 * The read-time filters are enforced here too, so an uncountable crash can never
 * take a slot: a driver in a respawn loop emits dozens of crashes under one
 * launchId, and appending them all would evict every other launch and hold the
 * distinct-launch counter at 1 forever.
 */
export function recordGpuCrashInHistory(
  userDataPath: string,
  entry: GpuCrashHistoryEntry,
  environment: WindowsGpuFallbackEnvironment
): void {
  if (entry.msSinceLaunch > GPU_CRASH_STARTUP_WINDOW_MS) {
    return
  }
  const existing = readActiveGpuCrashHistory(userDataPath, environment)
  if (existing.some((crash) => crash.launchId === entry.launchId)) {
    return
  }
  writeGpuCrashHistory(userDataPath, {
    schemeVersion: GPU_CRASH_HISTORY_SCHEME_VERSION,
    appVersion: environment.appVersion,
    electronVersion: environment.electronVersion,
    platform: 'win32',
    crashes: [...existing, entry].slice(-GPU_CRASH_HISTORY_MAX_ENTRIES)
  })
}

/**
 * Drops one launch's evidence and keeps every other launch's.
 *
 * Why scoped: a launch answers only for itself. It painted a window and survived,
 * or the user declined the in-session prompt it raised — neither says anything
 * about the earlier launches that died before any window existed.
 */
export function forgetGpuCrashLaunch(userDataPath: string, launchId: string): void {
  const history = readGpuCrashHistory(userDataPath)
  if (!history) {
    return
  }
  const crashes = history.crashes.filter((crash) => crash.launchId !== launchId)
  if (crashes.length === history.crashes.length) {
    return
  }
  if (crashes.length === 0) {
    clearGpuCrashHistory(userDataPath)
    return
  }
  writeGpuCrashHistory(userDataPath, { ...history, crashes })
}

/**
 * Distinct launches whose GPU child died during startup inside the horizon.
 *
 * Why both filters: without the wall-clock horizon a healthy machine
 * accumulates a false positive over months, and without the startup window a
 * crash 20 minutes into a session (the in-session tracker's job) would feed a
 * counter that means "cannot even boot".
 */
export function countStartupGpuCrashLaunches(
  crashes: readonly GpuCrashHistoryEntry[],
  nowEpochMs: number
): number {
  const launchIds = new Set<string>()
  for (const crash of crashes) {
    // Why absolute: atEpochMs is stamped ~600ms into boot, before W32Time corrects a
    // wrong RTC, so a later backward correction leaves future-dated entries that a
    // one-directional horizon would never age out — evidence immortal for the build.
    if (Math.abs(nowEpochMs - crash.atEpochMs) > GPU_CRASH_HISTORY_HORIZON_MS) {
      continue
    }
    if (crash.msSinceLaunch > GPU_CRASH_STARTUP_WINDOW_MS) {
      continue
    }
    launchIds.add(crash.launchId)
  }
  return launchIds.size
}
