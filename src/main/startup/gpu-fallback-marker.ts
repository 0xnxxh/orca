import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

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

export type GpuFallbackEnvironment = {
  appVersion: string
  electronVersion: string
  platform: NodeJS.Platform
}

export type WindowsGpuFallbackEnvironment = GpuFallbackEnvironment & { platform: 'win32' }

/** `user` = asked for in Settings, so it outlives app and Electron updates; `automatic` = derived from crashes. */
export type GpuFallbackMarkerSource = 'automatic' | 'user'

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

export function readGpuFallbackMarker(userDataPath: string): GpuFallbackMarker | null {
  try {
    const parsed = JSON.parse(readFileSync(markerPath(userDataPath), 'utf-8')) as Partial<
      Record<keyof GpuFallbackMarker, unknown>
    >
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
  } catch {
    // missing or corrupt means no fallback requested
  }
  return null
}

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
  writeFileSync(markerPath(userDataPath), JSON.stringify(marker))
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
  environment: GpuFallbackEnvironment
): GpuFallbackMarkerState {
  const marker = readGpuFallbackMarker(userDataPath)
  if (!marker) {
    if (existsSync(markerPath(userDataPath))) {
      clearGpuFallbackMarker(userDataPath)
    }
    return { active: null, supersededBuild: null }
  }
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
    return marker.source === 'user'
      ? { active: marker, supersededBuild: null }
      : { active: null, supersededBuild: marker }
  }
  return { active: marker, supersededBuild: null }
}

export function readActiveGpuFallbackMarker(
  userDataPath: string,
  environment: GpuFallbackEnvironment
): GpuFallbackMarker | null {
  return readGpuFallbackMarkerState(userDataPath, environment).active
}

/** Drops the previous build's record once this build proved it boots; never touches an active marker. */
export function clearSupersededGpuFallbackMarker(
  userDataPath: string,
  environment: GpuFallbackEnvironment
): void {
  if (readGpuFallbackMarkerState(userDataPath, environment).supersededBuild) {
    clearGpuFallbackMarker(userDataPath)
  }
}
