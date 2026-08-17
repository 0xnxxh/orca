import {
  CROSS_LAUNCH_GPU_FALLBACK_THRESHOLD,
  CROSS_LAUNCH_GPU_FALLBACK_THRESHOLD_AFTER_UPDATE,
  countStartupGpuCrashLaunches,
  type GpuCrashHistoryEntry
} from './gpu-crash-history'
import type { GpuFallbackEnvironment, GpuFallbackMarker } from './gpu-fallback-marker'

export type GpuFallbackLaunchDecision = {
  /** Disable hardware acceleration before app.whenReady() for this launch. */
  engage: boolean
  /**
   * `marker` = a previous launch already decided; the `crash-history` reasons mean
   * this launch is deciding now off persisted evidence and must write the marker,
   * `-after-update` on the lowered post-update threshold.
   */
  reason:
    | 'marker'
    | 'crash-history'
    | 'crash-history-after-update'
    | 'no-evidence'
    | 'unsupported-platform'
  /** Crashing launches (or the marker's recorded count) behind the decision. */
  crashesInWindow: number
  /** Epoch ms this engagement began — identity of the downgrade for the renderer notice. */
  engagedAt: number | null
}

/**
 * Whether this launch should boot in software rendering, decided from the two
 * durable artifacts only. Pure so the cross-launch behavior is testable without
 * an Electron app object or timers.
 *
 * Order matters: an existing marker wins, so a build that already fell back
 * never re-derives the decision from stale evidence.
 */
export function decideGpuFallbackForLaunch({
  marker,
  supersededBuildMarker = null,
  history,
  nowEpochMs,
  environment
}: {
  /** Build-scoped marker, already validated by readActiveGpuFallbackMarker. */
  marker: GpuFallbackMarker | null
  /** Marker left by a build this one replaced; lowers the threshold to one crashing launch. */
  supersededBuildMarker?: GpuFallbackMarker | null
  /** Build-scoped crash history, already validated by readActiveGpuCrashHistory. */
  history: readonly GpuCrashHistoryEntry[]
  nowEpochMs: number
  environment: GpuFallbackEnvironment
}): GpuFallbackLaunchDecision {
  if (environment.platform !== 'win32') {
    return { engage: false, reason: 'unsupported-platform', crashesInWindow: 0, engagedAt: null }
  }
  if (marker) {
    return {
      engage: true,
      reason: 'marker',
      crashesInWindow: marker.crashesInWindow,
      engagedAt: marker.engagedAt
    }
  }
  const crashingLaunches = countStartupGpuCrashLaunches(history, nowEpochMs)
  const threshold = supersededBuildMarker
    ? CROSS_LAUNCH_GPU_FALLBACK_THRESHOLD_AFTER_UPDATE
    : CROSS_LAUNCH_GPU_FALLBACK_THRESHOLD
  if (crashingLaunches >= threshold) {
    return {
      engage: true,
      reason: supersededBuildMarker ? 'crash-history-after-update' : 'crash-history',
      crashesInWindow: crashingLaunches,
      engagedAt: nowEpochMs
    }
  }
  return {
    engage: false,
    reason: 'no-evidence',
    crashesInWindow: crashingLaunches,
    engagedAt: null
  }
}

/** `clear-all` = the driver works today; `forget-this-launch` = only this launch is exonerated. */
export type GpuCrashHistoryResetAction = 'clear-all' | 'forget-this-launch' | 'none'

/**
 * What a launch that painted a window and then survived a minute has proved.
 *
 * With software rendering on there is no GPU child left to die, so surviving says
 * nothing about the driver — and if the marker write failed, the history is the
 * only thing keeping the fallback on.
 *
 * A launch whose GPU child died during startup and painted anyway is not "cannot
 * even boot", so it stops counting for itself; but the launches that died before
 * any window existed are not this launch's to exonerate.
 */
export function resolveGpuCrashHistoryReset({
  gpuCrashedDuringStartup,
  gpuFallbackActive
}: {
  gpuCrashedDuringStartup: boolean
  gpuFallbackActive: boolean
}): GpuCrashHistoryResetAction {
  if (gpuFallbackActive) {
    return 'none'
  }
  return gpuCrashedDuringStartup ? 'forget-this-launch' : 'clear-all'
}
