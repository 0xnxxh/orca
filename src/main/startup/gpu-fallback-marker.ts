import { rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  durableWriteTempPath,
  removeStaleDurableWriteTempFiles,
  writeFileDurableSync
} from '../durable-file-write'
import type { GpuFallbackSource } from '../../shared/gpu-fallback-status'
import { readPersistedJson } from './persisted-json-read'

/**
 * Persisted "disable hardware acceleration for this build" marker.
 *
 * Why a standalone file (not the Store): app.disableHardwareAcceleration() must
 * be called before app.whenReady() resolves, but the settings Store is only
 * constructed inside whenReady. A tiny JSON marker in userData can be read
 * synchronously during early startup, mirroring windows-user-data-acl.ts.
 */

export const GPU_FALLBACK_MARKER_FILE = 'gpu-fallback.json'
export const GPU_FALLBACK_SCHEME_VERSION = 2

/**
 * How long an automatic marker left by a superseded build stays live evidence.
 *
 * Why bounded at all: unlike the crash history it has no horizon, and its only reaper needs a
 * launch that survives a minute — a machine used in short bursts never spends it. Without this
 * a record from a driver generation ago would keep the post-update threshold at one crash, so
 * a single TDR years later pins software rendering for the whole build with no prompt.
 * Why a month and not days: the record is what spares a chronically broken machine three
 * unbootable launches per release, and update gaps of a couple of weeks are ordinary.
 */
export const GPU_FALLBACK_SUPERSEDED_MARKER_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

/** Spares another instance's in-flight write; nothing this old can still be mid-rename. */
const GPU_FALLBACK_MARKER_TEMP_MIN_AGE_MS = 600_000

export type GpuFallbackEnvironment = {
  appVersion: string
  electronVersion: string
  platform: NodeJS.Platform
}

export type WindowsGpuFallbackEnvironment = GpuFallbackEnvironment & { platform: 'win32' }

/** `user` = asked for in Settings, so it outlives app and Electron updates; `automatic` = derived from crashes. */
export type GpuFallbackMarkerSource = GpuFallbackSource

export type GpuFallbackMarker = {
  schemeVersion: number
  engagedAt: number
  crashesInWindow: number
  appVersion: string
  electronVersion: string
  platform: 'win32'
  source: GpuFallbackMarkerSource
}

export type GpuFallbackMarkerState = {
  /** The engagement in force for this build. */
  active: GpuFallbackMarker | null
  /** An engagement left by a different build: this build gets one fresh hardware attempt first. */
  supersededBuild: GpuFallbackMarker | null
}

function markerPath(userDataPath: string): string {
  return join(userDataPath, GPU_FALLBACK_MARKER_FILE)
}

function parseMarker(value: unknown): GpuFallbackMarker | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const parsed = value as Partial<Record<keyof GpuFallbackMarker, unknown>>
  if (parsed.schemeVersion !== GPU_FALLBACK_SCHEME_VERSION) {
    return null
  }
  if (
    typeof parsed.engagedAt !== 'number' ||
    !Number.isFinite(parsed.engagedAt) ||
    typeof parsed.crashesInWindow !== 'number' ||
    !Number.isFinite(parsed.crashesInWindow) ||
    typeof parsed.appVersion !== 'string' ||
    typeof parsed.electronVersion !== 'string' ||
    parsed.platform !== 'win32'
  ) {
    return null
  }
  return {
    schemeVersion: GPU_FALLBACK_SCHEME_VERSION,
    engagedAt: parsed.engagedAt,
    crashesInWindow: parsed.crashesInWindow,
    appVersion: parsed.appVersion,
    electronVersion: parsed.electronVersion,
    platform: parsed.platform,
    // Why: markers written before the Settings pin existed carry no source; they were all automatic.
    source: parsed.source === 'user' ? 'user' : 'automatic'
  }
}

export function readGpuFallbackMarker(userDataPath: string): GpuFallbackMarker | null {
  const read = readPersistedJson(markerPath(userDataPath), parseMarker)
  return read.kind === 'ok' ? read.value : null
}

/**
 * Durable (fsync + rename) for the same reason the crash history is, and then some: this is
 * written by a process Chromium may FATAL milliseconds later, and both callers drop the crash
 * history the instant it returns. A torn marker paired with a deleted history would leave the
 * machine with no evidence at all — back to the unbootable loop this rescue exists to break.
 */
export function writeGpuFallbackMarker(
  userDataPath: string,
  info: { engagedAt: number; crashesInWindow: number; source?: GpuFallbackMarkerSource },
  environment: WindowsGpuFallbackEnvironment
): void {
  const marker: GpuFallbackMarker = {
    schemeVersion: GPU_FALLBACK_SCHEME_VERSION,
    engagedAt: info.engagedAt,
    crashesInWindow: info.crashesInWindow,
    appVersion: environment.appVersion,
    electronVersion: environment.electronVersion,
    platform: 'win32',
    source: info.source ?? 'automatic'
  }
  const target = markerPath(userDataPath)
  const temp = durableWriteTempPath(target)
  try {
    writeFileDurableSync(temp, target, JSON.stringify(marker))
  } catch (error) {
    try {
      rmSync(temp, { force: true })
    } catch {
      // sweepOrphanedGpuFallbackMarkerWrites reclaims it later
    }
    throw error
  }
}

/** Reclaims temps orphaned by a death between write and rename; the name carries the pid, so they never collide. */
export function sweepOrphanedGpuFallbackMarkerWrites(userDataPath: string): void {
  void removeStaleDurableWriteTempFiles(markerPath(userDataPath), {
    minimumAgeMs: GPU_FALLBACK_MARKER_TEMP_MIN_AGE_MS
  }).catch(() => {
    // best effort; an orphaned temp file costs a few bytes
  })
}

export function clearGpuFallbackMarker(userDataPath: string): void {
  try {
    rmSync(markerPath(userDataPath), { force: true })
  } catch {
    // best effort; a stale marker is revalidated on the next launch
  }
}

export function readGpuFallbackMarkerState(
  userDataPath: string,
  environment: GpuFallbackEnvironment,
  nowEpochMs: number = Date.now()
): GpuFallbackMarkerState {
  const read = readPersistedJson(markerPath(userDataPath), parseMarker)
  if (read.kind !== 'ok') {
    // Why: delete only what parsed as not-ours. A marker this process could not open is still
    // the standing decision, and deleting it would silently restore the hardware launch that
    // the machine cannot survive. See readActiveGpuCrashHistory for the same reasoning.
    if (read.kind === 'invalid') {
      clearGpuFallbackMarker(userDataPath)
    }
    return { active: null, supersededBuild: null }
  }
  const marker = read.value
  if (environment.platform !== 'win32' || marker.platform !== environment.platform) {
    clearGpuFallbackMarker(userDataPath)
    return { active: null, supersededBuild: null }
  }
  if (
    marker.appVersion !== environment.appVersion ||
    marker.electronVersion !== environment.electronVersion
  ) {
    // Why: an automatic marker is sticky only for the build that observed the crash
    // burst, so updates get one fresh hardware attempt — but the record is kept, or a
    // machine that cannot boot would pay the full threshold again after every release.
    // A pin is the user's standing choice and an update is not consent to undo it.
    if (marker.source === 'user') {
      return { active: marker, supersededBuild: null }
    }
    // Why absolute, as in countStartupGpuCrashLaunches: engagedAt can be stamped by a wrong
    // RTC that W32Time later corrects backwards, and a one-directional bound never ages those.
    if (Math.abs(nowEpochMs - marker.engagedAt) > GPU_FALLBACK_SUPERSEDED_MARKER_MAX_AGE_MS) {
      clearGpuFallbackMarker(userDataPath)
      return { active: null, supersededBuild: null }
    }
    return { active: null, supersededBuild: marker }
  }
  return { active: marker, supersededBuild: null }
}

export function readActiveGpuFallbackMarker(
  userDataPath: string,
  environment: GpuFallbackEnvironment,
  nowEpochMs: number = Date.now()
): GpuFallbackMarker | null {
  return readGpuFallbackMarkerState(userDataPath, environment, nowEpochMs).active
}

/** Drops the previous build's record once this build proved it boots; never touches an active marker. */
export function clearSupersededGpuFallbackMarker(
  userDataPath: string,
  environment: GpuFallbackEnvironment,
  nowEpochMs: number = Date.now()
): void {
  if (readGpuFallbackMarkerState(userDataPath, environment, nowEpochMs).supersededBuild) {
    clearGpuFallbackMarker(userDataPath)
  }
}
