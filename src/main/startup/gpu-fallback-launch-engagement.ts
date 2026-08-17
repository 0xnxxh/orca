import type { CrashReportBreadcrumbData } from '../../shared/crash-reporting'
import { clearGpuCrashHistory, readActiveGpuCrashHistory } from './gpu-crash-history'
import {
  decideGpuFallbackForLaunch,
  type GpuFallbackLaunchDecision
} from './gpu-fallback-launch-decision'
import {
  readGpuFallbackMarkerState,
  writeGpuFallbackMarker,
  type GpuFallbackEnvironment
} from './gpu-fallback-marker'
import {
  applyGpuFallbackCommandLineSwitches,
  type GpuFallbackCommandLine
} from './gpu-fallback-switches'

export type GpuFallbackLaunchHooks = {
  /** app.disableHardwareAcceleration — must run before app.whenReady() resolves. */
  disableHardwareAcceleration: () => void
  commandLine: GpuFallbackCommandLine
  recordBreadcrumb: (name: string, data?: CrashReportBreadcrumbData) => void
}

/**
 * Decides and applies software rendering for the launch in progress.
 *
 * Runs before whenReady, so there is no window to prompt on: when the persisted
 * crash history crosses the threshold this engages *silently* and promotes the
 * evidence to a marker. The renderer notice explains it after the fact and
 * offers the way back. The in-session prompt+relaunch path stays as-is — it is
 * correct precisely because the app is alive enough to ask.
 */
export function engageGpuFallbackForLaunch({
  userDataPath,
  environment,
  nowEpochMs,
  hooks
}: {
  userDataPath: string
  environment: GpuFallbackEnvironment
  nowEpochMs: number
  hooks: GpuFallbackLaunchHooks
}): GpuFallbackLaunchDecision {
  const markerState = readGpuFallbackMarkerState(userDataPath, environment, nowEpochMs)
  const decision = decideGpuFallbackForLaunch({
    marker: markerState.active,
    supersededBuildMarker: markerState.supersededBuild,
    history: readActiveGpuCrashHistory(userDataPath, environment),
    nowEpochMs,
    environment
  })
  if (!decision.engage) {
    return decision
  }
  hooks.disableHardwareAcceleration()
  const appliedSwitches = applyGpuFallbackCommandLineSwitches(
    hooks.commandLine,
    environment.platform
  )
  if (decision.reason !== 'marker' && environment.platform === 'win32') {
    try {
      writeGpuFallbackMarker(
        userDataPath,
        { engagedAt: nowEpochMs, crashesInWindow: decision.crashesInWindow },
        { ...environment, platform: 'win32' }
      )
      // Why: the evidence is spent once it becomes a decision — leaving it would
      // re-engage immediately after the user asks for hardware acceleration back.
      clearGpuCrashHistory(userDataPath)
    } catch (error) {
      // Why: this runs before whenReady — a userData EPERM must not turn a
      // graphics workaround into a startup crash. The history re-derives it.
      console.warn('[gpu-fallback] failed to persist marker:', error)
    }
  }
  // Why: with no GPU child left, child-process-gone can't report a GPU fault, so
  // name the applied switches in the trail any later crash report carries.
  hooks.recordBreadcrumb('gpu_fallback_applied', {
    source: decision.reason,
    crashesInWindow: decision.crashesInWindow,
    switches: appliedSwitches.join(',')
  })
  return decision
}
