import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import {
  MAC_UPDATE_FENCE_ABSOLUTE_LIFETIME_MS,
  MAC_UPDATE_FENCE_BUNDLE_IDENTIFIER,
  MAC_UPDATE_FENCE_FRESH_LEASE_MS,
  isMacUpdateFenceVersion,
  type MacUpdateInstallFence
} from '../shared/mac-update-install-fence'
import {
  canonicalizeMacUpdatePath,
  createMacUpdateInstallFence,
  getMacShipItStatePath,
  readMacUpdateInstallFence,
  removeInvalidMacUpdateInstallFence,
  removeMacUpdateInstallFence,
  updateMacUpdateInstallFence
} from './mac-update-install-fence-storage'
import {
  findMacProductionProcessBlocker,
  getMacUpdateFenceMonitorMarker,
  isFenceMonitorIdentityAliveSync,
  isMatchingShipItProcessAliveSync,
  type MacProductionProcessBlocker
} from './mac-update-install-processes'
import { trackMacUpdateFenceEvent } from './mac-update-install-fence-telemetry'

const MONITOR_READY_TIMEOUT_MS = 5_000
// Why: a LaunchServices process already spawned when the fence was armed can
// need up to roughly three seconds to reach the JS gate and exit.
const QUIESCENCE_TIMEOUT_MS = 3_500
const QUIESCENCE_POLL_MS = 100

export type MacUpdateInstallFenceHandle = {
  attemptId: string
  monitorPid: number
  executablePath: string
  targetBundlePath: string
  sourceVersion: string
  targetVersion: string
  monitor: ChildProcess
  committed: boolean
}

export function shouldUseMacUpdateInstallFence(): boolean {
  return (
    process.platform === 'darwin' &&
    app.isPackaged &&
    process.env.ORCA_DISABLE_MAC_UPDATE_INSTALL_FENCE !== '1'
  )
}

export async function armMacUpdateInstallFence(
  targetVersion: string
): Promise<MacUpdateInstallFenceHandle | null> {
  if (!shouldUseMacUpdateInstallFence()) {
    return null
  }
  // Why: a fence with an unparseable targetVersion reads back as malformed
  // everywhere — the monitor can never own it and the error path cannot remove
  // it — so refuse to write one at all.
  if (!isMacUpdateFenceVersion(targetVersion)) {
    throw new Error('The macOS update install fence needs a parseable target version')
  }
  const targetBundlePath = canonicalizeMacUpdatePath(resolveBundlePath(process.execPath))
  const executablePath = canonicalizeMacUpdatePath(process.execPath)
  const shipItStatePath = canonicalizeMacUpdatePath(getMacShipItStatePath())
  const attemptId = randomUUID()
  const sourceVersion = app.getVersion()
  const monitorEntryPath = resolveMonitorEntryPath()
  if (!existsSync(monitorEntryPath)) {
    throw new Error('The packaged macOS update fence monitor is missing')
  }
  const monitor = spawn(
    process.execPath,
    [monitorEntryPath, getMacUpdateFenceMonitorMarker(), attemptId],
    {
      cwd: '/',
      detached: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc']
    }
  )
  if (!monitor.pid) {
    monitor.kill()
    throw new Error('The macOS update fence monitor did not receive a PID')
  }
  const now = Date.now()
  const fence: MacUpdateInstallFence = {
    schemaVersion: 1,
    attemptId,
    bundleIdentifier: MAC_UPDATE_FENCE_BUNDLE_IDENTIFIER,
    sourceVersion,
    targetVersion,
    targetBundlePath,
    shipItStatePath,
    sourcePid: process.pid,
    monitorPid: monitor.pid,
    phase: 'armed',
    createdAt: now,
    heartbeatAt: now,
    lastTransitionAt: now,
    absoluteExpiresAt: now + MAC_UPDATE_FENCE_ABSOLUTE_LIFETIME_MS
  }

  try {
    reclaimAbandonedMacUpdateInstallFence()
    createMacUpdateInstallFence(fence)
    trackMacUpdateFenceEvent('mac_update_fence_armed', {
      attempt_id: attemptId,
      source_version: sourceVersion,
      target_version: targetVersion
    })
    await waitForMonitorReady(monitor, attemptId)
  } catch (error) {
    monitor.kill('SIGTERM')
    removeMacUpdateInstallFence(attemptId)
    throw error
  }
  monitor.unref()
  monitor.channel?.unref()
  trackMacUpdateFenceEvent('mac_update_fence_monitor_ready', {
    attempt_id: attemptId,
    source_version: sourceVersion,
    target_version: targetVersion
  })
  return {
    attemptId,
    monitorPid: monitor.pid,
    executablePath,
    targetBundlePath,
    sourceVersion,
    targetVersion,
    monitor,
    committed: false
  }
}

export async function waitForMacUpdateFenceQuiescence(
  handle: MacUpdateInstallFenceHandle
): Promise<MacProductionProcessBlocker | null> {
  const deadline = Date.now() + QUIESCENCE_TIMEOUT_MS
  let blocker: MacProductionProcessBlocker | null
  do {
    blocker = await scanForMacUpdateBlocker(handle)
    if (!blocker) {
      return null
    }
    await delay(QUIESCENCE_POLL_MS)
  } while (Date.now() < deadline)
  return blocker
}

export function scanForMacUpdateBlocker(
  handle: MacUpdateInstallFenceHandle
): Promise<MacProductionProcessBlocker | null> {
  return findMacProductionProcessBlocker({
    executablePath: handle.executablePath,
    excludedPids: new Set([process.pid, handle.monitorPid])
  })
}

export function commitMacUpdateInstallFence(handle: MacUpdateInstallFenceHandle): void {
  const now = Date.now()
  const updated = updateMacUpdateInstallFence(handle.attemptId, (fence) => ({
    ...fence,
    phase: 'awaiting-shipit',
    heartbeatAt: now,
    lastTransitionAt: now
  }))
  if (!updated) {
    throw new Error('The macOS update install fence was lost before commit')
  }
  handle.committed = true
  trackMacUpdateFenceEvent('mac_update_fence_awaiting_shipit', {
    attempt_id: handle.attemptId,
    source_version: handle.sourceVersion,
    target_version: handle.targetVersion
  })
}

export function abortMacUpdateInstallFence(
  handle: MacUpdateInstallFenceHandle | null,
  options: { force?: boolean } = {}
): void {
  if (!handle || (handle.committed && !options.force)) {
    return
  }
  handle.monitor.kill('SIGTERM')
  removeMacUpdateInstallFence(handle.attemptId)
}

// Why: a leftover fence whose monitor died while this app session stayed open
// would otherwise make every in-session update retry fail with EEXIST until
// the app restarts (the startup gate only reclaims stale fences at launch).
function reclaimAbandonedMacUpdateInstallFence(): void {
  const read = readMacUpdateInstallFence()
  if (read.kind === 'invalid') {
    // Why unknown_schema is kept: a newer app owns that fence; deleting state
    // we cannot interpret could abort its install. Create will fail EEXIST and
    // this arm degrades to an unfenced install.
    if (read.reason === 'malformed') {
      removeInvalidMacUpdateInstallFence()
    }
    return
  }
  if (read.kind !== 'valid') {
    return
  }
  const existing = read.fence
  const now = Date.now()
  // Why heartbeatAt <= now: a clock-clamped future heartbeat is not proof of
  // liveness (backward wall-clock step) — let the process probes decide.
  const leaseFresh =
    existing.heartbeatAt <= now &&
    now - existing.heartbeatAt <= MAC_UPDATE_FENCE_FRESH_LEASE_MS &&
    now < existing.absoluteExpiresAt
  if (leaseFresh) {
    return
  }
  if (isFenceMonitorIdentityAliveSync(existing) || isMatchingShipItProcessAliveSync(existing)) {
    return
  }
  removeMacUpdateInstallFence(existing.attemptId)
}

function resolveBundlePath(executablePath: string): string {
  const macOsPath = join(executablePath, '..')
  const contentsPath = join(macOsPath, '..')
  const bundlePath = join(contentsPath, '..')
  if (!bundlePath.toLowerCase().endsWith('.app')) {
    throw new Error('The packaged executable is not inside a macOS app bundle')
  }
  return bundlePath
}

function resolveMonitorEntryPath(): string {
  const appPath = app.getAppPath()
  const basePath = appPath.replace('app.asar', 'app.asar.unpacked')
  const adjacentEntry = join(basePath, 'mac-update-install-fence-monitor.js')
  return existsSync(adjacentEntry)
    ? adjacentEntry
    : join(basePath, 'out', 'main', 'mac-update-install-fence-monitor.js')
}

function waitForMonitorReady(monitor: ChildProcess, attemptId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => finish(new Error('The macOS update fence monitor timed out')),
      MONITOR_READY_TIMEOUT_MS
    )
    const finish = (error?: Error): void => {
      clearTimeout(timeout)
      monitor.off('message', onMessage)
      monitor.off('error', onError)
      monitor.off('exit', onExit)
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    }
    const onMessage = (message: unknown): void => {
      if (
        typeof message === 'object' &&
        message !== null &&
        'type' in message &&
        message.type === 'mac-update-fence-monitor-ready' &&
        'attemptId' in message &&
        message.attemptId === attemptId
      ) {
        finish()
      }
    }
    const onError = (): void => finish(new Error('The macOS update fence monitor failed'))
    const onExit = (): void => finish(new Error('The macOS update fence monitor exited early'))
    monitor.on('message', onMessage)
    monitor.once('error', onError)
    monitor.once('exit', onExit)
  })
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
