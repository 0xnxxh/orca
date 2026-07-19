import { join } from 'node:path'
import {
  MAC_UPDATE_FENCE_FRESH_LEASE_MS,
  MAC_UPDATE_FENCE_RECOVERY_GRACE_MS,
  decideMacUpdateFenceStartup,
  type MacUpdateInstallFence
} from '../../shared/mac-update-install-fence'
import {
  canonicalizeMacUpdatePath,
  readMacUpdateInstallFence
} from '../../main/mac-update-install-fence-storage'
import {
  hasCurrentShipItStateEvidence,
  hasFenceMonitorIdentity,
  hasMatchingShipItProcess,
  hasSourceApplicationProcess,
  readMacProcessTable,
  type MacProcessRecord
} from '../../main/mac-update-install-processes'
import { readMacBundlePlistValue } from '../../main/mac-bundle-plist'
import { RuntimeClientError } from './types'

// Why: a fresh arm during the grace delay replaces the fence's attemptId; the
// new fence must be evaluated, but re-arms are bounded so the loop is too.
const MAX_FENCE_EVALUATIONS = 3

type FenceEvaluation =
  | { kind: 'allow' }
  | { kind: 'block'; targetVersion: string }
  | { kind: 'reevaluate'; fence: MacUpdateInstallFence }

export async function assertMacUpdateInstallLaunchAllowed(options: {
  targetBundlePath: string | null
  allowArmedActivation: boolean
}): Promise<void> {
  if (process.platform !== 'darwin' || !options.targetBundlePath) {
    return
  }
  // Why: the same kill switch that disables arming must also disable
  // enforcement so support can fully bypass the fence in the field.
  if (process.env.ORCA_DISABLE_MAC_UPDATE_INSTALL_FENCE === '1') {
    return
  }
  const currentBundlePath = canonicalizePath(options.targetBundlePath)
  if (!currentBundlePath) {
    return
  }
  let fence = readFence()
  for (let evaluation = 1; fence && evaluation <= MAX_FENCE_EVALUATIONS; evaluation += 1) {
    const outcome = await evaluateFence(fence, currentBundlePath, options.allowArmedActivation)
    if (outcome.kind === 'reevaluate') {
      fence = outcome.fence
      continue
    }
    if (outcome.kind === 'block') {
      throw new RuntimeClientError(
        'update_install_in_progress',
        `Orca is installing ${outcome.targetVersion}. Wait for the update to finish, then try again.`
      )
    }
    return
  }
}

async function evaluateFence(
  initialFence: MacUpdateInstallFence,
  currentBundlePath: string,
  allowArmedActivation: boolean
): Promise<FenceEvaluation> {
  let fence = initialFence
  let now = Date.now()
  let leaseAdvancedDuringGrace = false
  if (now < fence.absoluteExpiresAt && now - fence.heartbeatAt > MAC_UPDATE_FENCE_FRESH_LEASE_MS) {
    const previousHeartbeat = fence.heartbeatAt
    await delay(MAC_UPDATE_FENCE_RECOVERY_GRACE_MS)
    const recoveredFence = readFence()
    if (!recoveredFence) {
      return { kind: 'allow' }
    }
    if (recoveredFence.attemptId !== fence.attemptId) {
      // Why: a changed attemptId means the running app just armed a fresh
      // attempt — evaluate the new fence instead of failing open mid-arm.
      return { kind: 'reevaluate', fence: recoveredFence }
    }
    fence = recoveredFence
    now = Date.now()
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
  const needsArmedSourceProbe = allowArmedActivation && fence.phase === 'armed'
  const processTable =
    needsStaleProbes || needsExpiryProbe || needsArmedSourceProbe
      ? await readProcessTableSafe()
      : null
  const decision = decideMacUpdateFenceStartup({
    fence,
    now,
    currentVersion: await readInstalledBundleVersion(currentBundlePath, fence),
    currentBundlePath,
    leaseAdvancedDuringGrace,
    monitorIdentityAlive: needsStaleProbes
      ? hasFenceMonitorIdentity(processTable ?? [], fence)
      : undefined,
    matchingShipItAlive:
      needsStaleProbes || needsExpiryProbe
        ? processTable
          ? hasMatchingShipItProcess(processTable, fence)
          : // Why: a failed ps must not launch into a live ShipIt. Pre-expiry,
            // a plist written by this attempt keeps blocking; at expiry the
            // fallback stops so a persistent ps failure stays bounded.
            now < fence.absoluteExpiresAt && hasCurrentShipItStateEvidence(fence)
        : undefined
  })
  if (decision.kind !== 'block') {
    return { kind: 'allow' }
  }
  if (
    needsArmedSourceProbe &&
    (processTable === null ||
      hasSourceApplicationProcess(
        processTable,
        fence,
        join(currentBundlePath, 'Contents', 'MacOS')
      ))
  ) {
    // Why: activating the still-running source app is safe while armed, and a
    // failed ps probe is no evidence it died — don't fail activation closed.
    return { kind: 'allow' }
  }
  return { kind: 'block', targetVersion: fence.targetVersion }
}

function readFence(): MacUpdateInstallFence | null {
  try {
    const read = readMacUpdateInstallFence()
    return read.kind === 'valid' ? read.fence : null
  } catch {
    // Why: CLI readers fail open so malformed or abandoned state cannot lock
    // users out of starting the desktop app.
    return null
  }
}

async function readInstalledBundleVersion(
  bundlePath: string,
  fence: MacUpdateInstallFence
): Promise<string> {
  const version = await readMacBundlePlistValue(bundlePath, 'CFBundleShortVersionString')
  // Why: an unreadable Info.plist is expected while ShipIt swaps the bundle;
  // substituting the fence's sourceVersion routes the decision to the
  // heartbeat/probe checks instead of the incomparable_version bypass.
  return version ?? fence.sourceVersion
}

async function readProcessTableSafe(): Promise<MacProcessRecord[] | null> {
  try {
    return await readMacProcessTable()
  } catch {
    return null
  }
}

function canonicalizePath(value: string): string | null {
  try {
    return canonicalizeMacUpdatePath(value)
  } catch {
    return null
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
