import { spawn } from 'node:child_process'
import { dirname } from 'node:path'
import { app } from 'electron'
import {
  MAC_UPDATE_FENCE_BUNDLE_IDENTIFIER,
  MAC_UPDATE_FENCE_FRESH_LEASE_MS,
  MAC_UPDATE_FENCE_RECOVERY_GRACE_MS,
  decideMacUpdateFenceStartup
} from '../../shared/mac-update-install-fence'
import {
  canonicalizeMacUpdatePath,
  readMacUpdateInstallFence,
  removeInvalidMacUpdateInstallFence,
  removeMacUpdateInstallFence,
  type MacUpdateFenceReadResult
} from '../mac-update-install-fence-storage'
import { writeMacUpdateFenceDiagnostic } from '../mac-update-install-fence-diagnostics'
import {
  hasCurrentShipItStateEvidence,
  hasFenceMonitorIdentity,
  hasMatchingShipItProcess,
  readMacProcessTableSync,
  type MacProcessRecord
} from '../mac-update-install-processes'
import { readMacBundlePlistValueSync } from '../mac-bundle-plist'

// Why: a fresh arm during the grace sleep replaces the fence's attemptId; the
// new fence must be evaluated, but re-arms are bounded so recursion is too.
const MAX_FENCE_EVALUATIONS = 3

export function runMacUpdateInstallFenceStartupGate(): boolean {
  if (process.platform !== 'darwin' || !app.isPackaged) {
    return true
  }
  // Why: the kill switch must disable enforcement, not just arming — support
  // needs a way out if a well-formed fence file itself misbehaves in the field.
  if (process.env.ORCA_DISABLE_MAC_UPDATE_INSTALL_FENCE === '1') {
    return true
  }

  try {
    const initialRead = readMacUpdateInstallFence()
    if (initialRead.kind === 'missing' || initialRead.kind === 'unreadable') {
      return true
    }
    const bundlePath = canonicalizeMacUpdatePath(getBundlePath(process.execPath))
    if (readBundleIdentifier(bundlePath) !== MAC_UPDATE_FENCE_BUNDLE_IDENTIFIER) {
      return true
    }
    return evaluateFence(bundlePath, initialRead)
  } catch {
    // Why: startup readers fail open; a damaged lease must never permanently
    // make the installed app unusable.
    return true
  }
}

function evaluateFence(
  currentBundlePath: string,
  initialRead: MacUpdateFenceReadResult,
  evaluation = 1
): boolean {
  let now = Date.now()
  let read = initialRead
  if (read.kind === 'missing' || read.kind === 'unreadable') {
    return true
  }
  if (read.kind === 'invalid') {
    // Why unknown_schema is kept: that fence belongs to a NEWER app which is
    // actively installing; deleting state we cannot interpret could abort its
    // install. Fail open without touching it (the CLI does the same).
    if (read.reason === 'malformed') {
      removeInvalidMacUpdateInstallFence()
      writeMacUpdateFenceDiagnostic('mac_update_fence_recovered', { reason: read.reason })
    }
    return true
  }

  let fence = read.fence
  let leaseAdvancedDuringGrace = false
  const leaseIsStale = now - fence.heartbeatAt > MAC_UPDATE_FENCE_FRESH_LEASE_MS
  if (leaseIsStale && now < fence.absoluteExpiresAt) {
    const previousHeartbeat = fence.heartbeatAt
    sleepSync(MAC_UPDATE_FENCE_RECOVERY_GRACE_MS)
    now = Date.now()
    read = readMacUpdateInstallFence(now)
    if (read.kind !== 'valid') {
      return true
    }
    if (read.fence.attemptId !== fence.attemptId) {
      // Why: a changed attemptId means a running app just armed a fresh
      // attempt — evaluate the new fence instead of failing open mid-arm.
      return evaluation >= MAX_FENCE_EVALUATIONS
        ? true
        : evaluateFence(currentBundlePath, read, evaluation + 1)
    }
    fence = read.fence
    leaseAdvancedDuringGrace = fence.heartbeatAt > previousHeartbeat
  }

  // Why the heartbeatAt > now arm: the decision distrusts clock-clamped future
  // heartbeats, so the probes must actually run there or a live monitor's
  // fence would read as stale_lease and be removed mid-install.
  const needsStaleProbes =
    now < fence.absoluteExpiresAt &&
    (now - fence.heartbeatAt > MAC_UPDATE_FENCE_FRESH_LEASE_MS || fence.heartbeatAt > now) &&
    !leaseAdvancedDuringGrace
  const needsExpiryProbe = now >= fence.absoluteExpiresAt
  const processTable = needsStaleProbes || needsExpiryProbe ? readProcessTableSafe() : null
  const decision = decideMacUpdateFenceStartup({
    fence,
    now,
    currentVersion: app.getVersion(),
    currentBundlePath,
    leaseAdvancedDuringGrace,
    monitorIdentityAlive: needsStaleProbes
      ? hasFenceMonitorIdentity(processTable ?? [], fence)
      : undefined,
    matchingShipItAlive:
      needsStaleProbes || needsExpiryProbe
        ? processTable
          ? hasMatchingShipItProcess(processTable, fence)
          : // Why: a failed ps must not remove the fence out from under a live
            // ShipIt. Pre-expiry, a plist written by this attempt is enough to
            // keep blocking; at expiry the fallback stops so a persistent ps
            // failure cannot extend the blackout past the fence lifetime.
            now < fence.absoluteExpiresAt && hasCurrentShipItStateEvidence(fence)
        : undefined
  })

  if (decision.kind === 'block') {
    writeMacUpdateFenceDiagnostic('mac_update_fence_launch_blocked', {
      attemptId: fence.attemptId,
      phase: fence.phase,
      reason: decision.reason,
      sourceVersion: fence.sourceVersion,
      targetVersion: fence.targetVersion
    })
    process.stderr.write(
      `[updater] Orca ${app.getVersion()} launch blocked while update ${fence.targetVersion} installs\n`
    )
    // Why: Dock/Finder launches never see stderr; without a dialog a blocked
    // launch reads as a dead app for however long the install runs.
    showLaunchBlockedNotice(fence.targetVersion)
    app.quit()
    return false
  }

  if (decision.action === 'remove') {
    removeMacUpdateInstallFence(fence.attemptId)
    if (decision.reason === 'target_installed') {
      writeMacUpdateFenceDiagnostic('mac_update_fence_target_observed', {
        attemptId: fence.attemptId,
        sourceVersion: fence.sourceVersion,
        targetVersion: fence.targetVersion
      })
    }
    writeMacUpdateFenceDiagnostic('mac_update_fence_recovered', {
      attemptId: fence.attemptId,
      reason: decision.reason,
      sourceVersion: fence.sourceVersion,
      targetVersion: fence.targetVersion
    })
  }
  return true
}

function getBundlePath(executablePath: string): string {
  const bundlePath = dirname(dirname(dirname(executablePath)))
  if (!bundlePath.toLowerCase().endsWith('.app')) {
    throw new Error('Executable is not inside a macOS app bundle')
  }
  return bundlePath
}

function readBundleIdentifier(bundlePath: string): string | null {
  return readMacBundlePlistValueSync(bundlePath, 'CFBundleIdentifier')
}

function readProcessTableSafe(): MacProcessRecord[] | null {
  try {
    return readMacProcessTableSync()
  } catch {
    return null
  }
}

function showLaunchBlockedNotice(targetVersion: string): void {
  try {
    // Why: any in-process UI (dialog.showErrorBox is a blocking NSAlert) keeps
    // this LaunchServices-visible process alive and can itself abort ShipIt's
    // running-instances check — the exact failure the fence prevents. Hand the
    // notice to a detached osascript so this process can exit immediately.
    // targetVersion is parse-validated semver, so it is safe to interpolate.
    spawn(
      '/usr/bin/osascript',
      [
        '-e',
        `display notification "Orca ${targetVersion} is still installing. Orca will reopen itself when the update finishes." with title "Orca is updating"`
      ],
      { detached: true, stdio: 'ignore' }
    ).unref()
  } catch {
    // Best-effort: the stderr line and diagnostics still record the block.
  }
}

const sleepBuffer = new Int32Array(new SharedArrayBuffer(4))
function sleepSync(milliseconds: number): void {
  // Why: no application module may initialize until the rare stale-lease
  // recovery check finishes, so this early gate intentionally waits in place.
  Atomics.wait(sleepBuffer, 0, 0, milliseconds)
}
