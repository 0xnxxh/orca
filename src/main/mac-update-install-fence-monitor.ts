import { spawn } from 'node:child_process'
import { join } from 'node:path'
import {
  MAC_UPDATE_FENCE_HEARTBEAT_MS,
  MAC_UPDATE_FENCE_SHIPIT_ABORT_CONFIRMATION_MS,
  MAC_UPDATE_FENCE_SHIPIT_APPEARANCE_MS,
  MAC_UPDATE_FENCE_SHIPIT_EXIT_CONFIRMATION_MS,
  decideMacUpdateFenceStartup,
  type MacUpdateInstallFence
} from '../shared/mac-update-install-fence'
import {
  getMacUpdateFencePaths,
  readMacUpdateInstallFence,
  removeMacUpdateInstallFence,
  updateMacUpdateInstallFence
} from './mac-update-install-fence-storage'
import { writeMacUpdateFenceDiagnostic } from './mac-update-install-fence-diagnostics'
import {
  getMacUpdateFenceMonitorMarker,
  hasCurrentShipItStateEvidence,
  isMatchingShipItProcessAlive,
  isSourceApplicationProcessAlive
} from './mac-update-install-processes'
import { readMacBundlePlistValue } from './mac-bundle-plist'

const STARTUP_FENCE_WAIT_MS = 5_000
// Why: one minute of continuous failure (ps fork pressure, lock contention)
// before giving up; a single transient error must not kill the heartbeat.
const MAX_CONSECUTIVE_ITERATION_FAILURES = 60
// Why: once ShipIt is confirmed, install completion is observed by the next
// launch's gate anyway; polling plutil every tick just burns a fork per second
// for the whole multi-minute install.
const INSTALLED_VERSION_POLL_TICKS = 5

type MonitorTerminalReason =
  | 'source_died'
  | 'shipit_not_seen'
  | 'installer_exited_without_target'
  | 'target_installed'
  | 'superseded'
  | 'absolute_timeout'

export async function runMacUpdateInstallFenceMonitor(attemptId: string): Promise<number> {
  if (process.platform !== 'darwin') {
    return 0
  }
  const paths = getMacUpdateFencePaths()
  const initialFence = await waitForOwnedFence(attemptId, paths)
  if (!initialFence) {
    return 1
  }

  // Why: ShipIt can rename the source bundle and invalidate its old cwd while
  // this detached process survives. Capture every loop dependency up front.
  const targetBundlePath = initialFence.targetBundlePath
  const sourceMacOsDirectory = join(initialFence.targetBundlePath, 'Contents', 'MacOS')
  let shipItAbsentSince: number | null = null
  let nextDeadline = Date.now()
  let consecutiveIterationFailures = 0
  let iterationIndex = 0

  if (!(await initialHeartbeatWithRetry(attemptId, paths))) {
    return 1
  }
  process.send?.({ type: 'mac-update-fence-monitor-ready', attemptId, pid: process.pid })
  // Why: readiness is the monitor's only parent handshake; closing IPC keeps
  // its detached lifetime independent from the quitting Electron process.
  process.disconnect?.()

  while (true) {
    // Why: a transient ps/lock failure must not kill this process — its death
    // silently downgrades the fence to the launchers' own process probes.
    try {
      const read = readMacUpdateInstallFence(Date.now(), paths)
      // Why: unreadable is a transient fs failure (EMFILE/EIO under install
      // pressure), NOT evidence the fence was removed — exiting here would
      // silently kill the heartbeat the whole fence design rests on.
      if (read.kind === 'unreadable') {
        throw new Error('The update install fence could not be read')
      }
      if (read.kind !== 'valid' || read.fence.attemptId !== attemptId) {
        return 0
      }
      const fence = read.fence
      const now = Date.now()
      const pollInstalledVersion = iterationIndex % INSTALLED_VERSION_POLL_TICKS === 0
      iterationIndex += 1
      // Why: the install cannot have completed while this process still owns
      // the armed phase, so skip the per-second plutil spawn until commit.
      const installedVersion =
        fence.phase === 'armed' || !pollInstalledVersion
          ? null
          : await readMacBundlePlistValue(targetBundlePath, 'CFBundleShortVersionString')
      if (installedVersion) {
        const installedDecision = decideMacUpdateFenceStartup({
          fence,
          now,
          currentVersion: installedVersion,
          currentBundlePath: fence.targetBundlePath
        })
        if (installedDecision.reason === 'target_installed') {
          writeMacUpdateFenceDiagnostic(
            'mac_update_fence_target_observed',
            {
              attemptId: fence.attemptId,
              sourceVersion: fence.sourceVersion,
              targetVersion: fence.targetVersion
            },
            paths
          )
          finishAttempt(fence, 'target_installed', paths)
          return 0
        }
        if (installedDecision.reason === 'superseded') {
          finishAttempt(fence, 'superseded', paths)
          return 0
        }
      }

      if (now >= fence.absoluteExpiresAt) {
        // Why: a genuinely slow install can outlive the absolute lifetime.
        // Removing the fence while ShipIt still runs would let a fresh launch
        // abort the swap — mirror the startup decision, which keeps blocking
        // on live ShipIt evidence at expiry. ShipIt's own exit is the bound.
        if (!(await isMatchingShipItProcessAlive(fence))) {
          finishAttempt(fence, 'absolute_timeout', paths)
          return 0
        }
      } else if (fence.phase === 'armed') {
        if (!(await isSourceApplicationProcessAlive(fence, sourceMacOsDirectory))) {
          finishAttempt(fence, 'source_died', paths)
          return 0
        }
      } else {
        const shipItAlive = await isMatchingShipItProcessAlive(fence)
        if (shipItAlive) {
          shipItAbsentSince = null
          if (fence.phase === 'awaiting-shipit') {
            transitionToInstalling(fence, now, paths)
          }
        } else if (fence.phase === 'awaiting-shipit') {
          const appearanceDeadline = fence.lastTransitionAt + MAC_UPDATE_FENCE_SHIPIT_APPEARANCE_MS
          // Why: a current plist only buys a bounded extension — an aborted
          // install leaves one behind, and an unbounded wait blacks out every
          // launch until the fence's absolute lifetime.
          const deadline = hasCurrentShipItStateEvidence(fence)
            ? appearanceDeadline + MAC_UPDATE_FENCE_SHIPIT_ABORT_CONFIRMATION_MS
            : appearanceDeadline
          // Why: no relaunch here — ShipIt never ran, so nothing failed
          // visibly. This path also covers quit-armed fences, where reopening
          // an app the user deliberately quit would be wrong.
          if (now >= deadline) {
            finishAttempt(fence, 'shipit_not_seen', paths)
            return 0
          }
        } else {
          shipItAbsentSince ??= now
          const absentFor = now - shipItAbsentSince
          const exitConfirmed = hasCurrentShipItStateEvidence(fence)
            ? absentFor >= MAC_UPDATE_FENCE_SHIPIT_ABORT_CONFIRMATION_MS
            : absentFor >= MAC_UPDATE_FENCE_SHIPIT_EXIT_CONFIRMATION_MS
          if (exitConfirmed) {
            finishAttempt(fence, 'installer_exited_without_target', paths)
            relaunchTargetBundle(fence.targetBundlePath)
            return 0
          }
        }
      }

      if (!heartbeat(attemptId, paths)) {
        return 0
      }
      consecutiveIterationFailures = 0
    } catch {
      consecutiveIterationFailures += 1
      if (consecutiveIterationFailures >= MAX_CONSECUTIVE_ITERATION_FAILURES) {
        return 1
      }
    }
    // Why: after a system sleep the accumulated deadline is far in the past;
    // without the clamp the loop would burn one zero-delay ps/plutil-forking
    // iteration per missed second to catch up.
    nextDeadline = Math.max(nextDeadline + MAC_UPDATE_FENCE_HEARTBEAT_MS, Date.now())
    await delay(Math.max(0, nextDeadline - Date.now()))
  }
}

async function waitForOwnedFence(
  attemptId: string,
  paths: ReturnType<typeof getMacUpdateFencePaths>
): Promise<MacUpdateInstallFence | null> {
  const deadline = Date.now() + STARTUP_FENCE_WAIT_MS
  while (Date.now() < deadline) {
    const read = readMacUpdateInstallFence(Date.now(), paths)
    if (read.kind === 'valid' && read.fence.attemptId === attemptId) {
      return read.fence
    }
    await delay(25)
  }
  return null
}

function heartbeat(attemptId: string, paths: ReturnType<typeof getMacUpdateFencePaths>): boolean {
  return updateMacUpdateInstallFence(
    attemptId,
    (fence) => ({ ...fence, heartbeatAt: Date.now() }),
    paths
  )
}

// Why: the first heartbeat runs before the loop's failure tolerance, and its
// death fails the whole update attempt — ride out transient lock contention
// (concurrent gate/diagnostics writers) the same way the loop does.
async function initialHeartbeatWithRetry(
  attemptId: string,
  paths: ReturnType<typeof getMacUpdateFencePaths>
): Promise<boolean> {
  const maxAttempts = 5
  for (let attempt = 1; ; attempt += 1) {
    try {
      return heartbeat(attemptId, paths)
    } catch (error) {
      if (attempt >= maxAttempts) {
        throw error
      }
      await delay(250)
    }
  }
}

function transitionToInstalling(
  fence: MacUpdateInstallFence,
  now: number,
  paths: ReturnType<typeof getMacUpdateFencePaths>
): void {
  updateMacUpdateInstallFence(
    fence.attemptId,
    (current) => ({
      ...current,
      phase: 'installing',
      heartbeatAt: now,
      lastTransitionAt: now,
      shipItSeenAt: current.shipItSeenAt ?? now
    }),
    paths
  )
  writeMacUpdateFenceDiagnostic(
    'mac_update_fence_shipit_seen',
    {
      attemptId: fence.attemptId,
      sourceVersion: fence.sourceVersion,
      targetVersion: fence.targetVersion
    },
    paths
  )
}

function relaunchTargetBundle(bundlePath: string): void {
  try {
    // Why: ShipIt only relaunches the app after a successful install. After an
    // abort the user is left with a silently closed app; reopening the (old)
    // bundle lets the next startup surface the install-failure notice.
    spawn('/usr/bin/open', [bundlePath], { detached: true, stdio: 'ignore' }).unref()
  } catch {
    // Best-effort: the fence is already removed, so a manual launch works.
  }
}

function finishAttempt(
  fence: MacUpdateInstallFence,
  reason: MonitorTerminalReason,
  paths: ReturnType<typeof getMacUpdateFencePaths>
): void {
  writeMacUpdateFenceDiagnostic(
    'mac_update_fence_recovered',
    {
      attemptId: fence.attemptId,
      reason,
      sourceVersion: fence.sourceVersion,
      targetVersion: fence.targetVersion
    },
    paths
  )
  removeMacUpdateInstallFence(fence.attemptId, paths)
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function main(): Promise<void> {
  const markerIndex = process.argv.indexOf(getMacUpdateFenceMonitorMarker())
  const attemptId = markerIndex >= 0 ? process.argv[markerIndex + 1] : undefined
  if (!attemptId) {
    process.stderr.write(
      'Usage: mac-update-install-fence-monitor --orca-update-fence-monitor <attempt-id>\n'
    )
    process.exitCode = 2
    return
  }
  try {
    process.exitCode = await runMacUpdateInstallFenceMonitor(attemptId)
  } catch {
    // Why: an unhandled rejection would end the process without an exit code
    // contract; startup failures surface to the parent via the exit event.
    process.exitCode = 1
  }
}

if (require.main === module) {
  void main()
}
