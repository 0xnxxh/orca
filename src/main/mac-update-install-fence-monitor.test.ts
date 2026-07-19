import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MacUpdateInstallFence } from '../shared/mac-update-install-fence'

const mocks = vi.hoisted(() => ({
  installedVersion: '1.0.1',
  execFile: vi.fn(),
  spawn: vi.fn(() => ({ unref: vi.fn() })),
  read: vi.fn(),
  remove: vi.fn(),
  update: vi.fn(() => true),
  diagnostic: vi.fn(),
  sourceAlive: vi.fn(async () => true),
  shipItAlive: vi.fn(async () => false),
  stat: vi.fn(),
  send: vi.fn(),
  disconnect: vi.fn()
}))

mocks.execFile.mockImplementation(
  (
    _command: string,
    _args: string[],
    _options: unknown,
    callback: (error: Error | null, result: { stdout: string; stderr: string }) => void
  ) => callback(null, { stdout: `${mocks.installedVersion}\n`, stderr: '' })
)

vi.mock('node:child_process', () => ({ execFile: mocks.execFile, spawn: mocks.spawn }))
vi.mock('node:fs', () => ({ statSync: mocks.stat }))
vi.mock('./mac-update-install-fence-storage', () => ({
  getMacUpdateFencePaths: () => ({
    fencePath: '/tmp/fence',
    directoryPath: '/tmp',
    lockPath: '/tmp/lock',
    diagnosticPath: '/tmp/diagnostic'
  }),
  readMacUpdateInstallFence: mocks.read,
  removeMacUpdateInstallFence: mocks.remove,
  updateMacUpdateInstallFence: mocks.update
}))
vi.mock('./mac-update-install-fence-diagnostics', () => ({
  writeMacUpdateFenceDiagnostic: mocks.diagnostic
}))
vi.mock('./mac-update-install-processes', () => ({
  getMacUpdateFenceMonitorMarker: () => '--orca-update-fence-monitor',
  // Mirrors the real helper (1s mtime slack) against the mocked stat so the
  // plist-evidence scenarios keep driving the monitor through mocks.stat.
  hasCurrentShipItStateEvidence: (fence: MacUpdateInstallFence) => {
    try {
      return (
        (mocks.stat(fence.shipItStatePath) as { mtimeMs: number }).mtimeMs >=
        fence.createdAt - 1_000
      )
    } catch {
      return false
    }
  },
  isMatchingShipItProcessAlive: mocks.shipItAlive,
  isSourceApplicationProcessAlive: mocks.sourceAlive
}))

import { runMacUpdateInstallFenceMonitor } from './mac-update-install-fence-monitor'

const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
const sendDescriptor = Object.getOwnPropertyDescriptor(process, 'send')
const disconnectDescriptor = Object.getOwnPropertyDescriptor(process, 'disconnect')

function createFence(overrides: Partial<MacUpdateInstallFence> = {}): MacUpdateInstallFence {
  const now = Date.now()
  return {
    schemaVersion: 1,
    attemptId: '38ec4bed-d852-4ba5-8259-96490b0461fd',
    bundleIdentifier: 'com.stablyai.orca',
    sourceVersion: '1.0.0',
    targetVersion: '1.0.1',
    targetBundlePath: '/Applications/Orca.app',
    shipItStatePath: '/tmp/com.stablyai.orca.ShipIt/ShipItState.plist',
    sourcePid: 100,
    monitorPid: 101,
    phase: 'installing',
    createdAt: now - 1_000,
    heartbeatAt: now,
    lastTransitionAt: now,
    absoluteExpiresAt: now + 30 * 60_000,
    ...overrides
  }
}

beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'darwin' })
  Object.defineProperty(process, 'send', { configurable: true, value: mocks.send })
  Object.defineProperty(process, 'disconnect', { configurable: true, value: mocks.disconnect })
  mocks.installedVersion = '1.0.1'
  mocks.spawn.mockClear()
  mocks.read.mockReset()
  mocks.remove.mockReset()
  mocks.update.mockReset().mockReturnValue(true)
  mocks.diagnostic.mockReset()
  mocks.sourceAlive.mockReset().mockResolvedValue(true)
  mocks.shipItAlive.mockReset().mockResolvedValue(false)
  mocks.stat.mockReset().mockImplementation(() => {
    throw new Error('missing')
  })
  mocks.send.mockReset()
  mocks.disconnect.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

afterAll(() => {
  if (platformDescriptor) {
    Object.defineProperty(process, 'platform', platformDescriptor)
  }
  if (sendDescriptor) {
    Object.defineProperty(process, 'send', sendDescriptor)
  } else {
    delete process.send
  }
  if (disconnectDescriptor) {
    Object.defineProperty(process, 'disconnect', disconnectDescriptor)
  } else {
    delete process.disconnect
  }
})

describe('mac update install fence monitor', () => {
  it('accepts the exact installed target before considering ShipIt visibility', async () => {
    const fence = createFence()
    mocks.read.mockReturnValue({ kind: 'valid', fence })

    await expect(runMacUpdateInstallFenceMonitor(fence.attemptId)).resolves.toBe(0)

    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'mac-update-fence-monitor-ready' })
    )
    expect(mocks.disconnect).toHaveBeenCalledOnce()
    expect(mocks.remove).toHaveBeenCalledWith(fence.attemptId, expect.anything())
    expect(mocks.diagnostic).toHaveBeenCalledWith(
      'mac_update_fence_target_observed',
      expect.objectContaining({ targetVersion: fence.targetVersion }),
      expect.anything()
    )
    expect(mocks.diagnostic).toHaveBeenCalledWith(
      'mac_update_fence_recovered',
      expect.objectContaining({ reason: 'target_installed' }),
      expect.anything()
    )
    expect(mocks.shipItAlive).not.toHaveBeenCalled()
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('clears an armed attempt when its source application dies', async () => {
    const fence = createFence({ phase: 'armed' })
    mocks.installedVersion = fence.sourceVersion
    mocks.read.mockReturnValue({ kind: 'valid', fence })
    mocks.sourceAlive.mockResolvedValue(false)

    await expect(runMacUpdateInstallFenceMonitor(fence.attemptId)).resolves.toBe(0)

    expect(mocks.diagnostic).toHaveBeenCalledWith(
      'mac_update_fence_recovered',
      expect.objectContaining({ reason: 'source_died' }),
      expect.anything()
    )
    expect(mocks.remove).toHaveBeenCalledWith(fence.attemptId, expect.anything())
  })

  it('recovers when ShipIt never appears and no current state plist exists', async () => {
    const fence = createFence({
      phase: 'awaiting-shipit',
      lastTransitionAt: Date.now() - 121_000
    })
    mocks.installedVersion = fence.sourceVersion
    mocks.read.mockReturnValue({ kind: 'valid', fence })
    // A plist older than this attempt is leftover from a previous install.
    mocks.stat.mockReturnValue({ mtimeMs: fence.createdAt - 60_000 })

    await expect(runMacUpdateInstallFenceMonitor(fence.attemptId)).resolves.toBe(0)

    expect(mocks.diagnostic).toHaveBeenCalledWith(
      'mac_update_fence_recovered',
      expect.objectContaining({ reason: 'shipit_not_seen' }),
      expect.anything()
    )
    expect(mocks.remove).toHaveBeenCalledWith(fence.attemptId, expect.anything())
  })

  it('keeps waiting past the appearance deadline while a current state plist exists', async () => {
    const fence = createFence({
      phase: 'awaiting-shipit',
      lastTransitionAt: Date.now() - 121_000
    })
    mocks.installedVersion = fence.sourceVersion
    mocks.read
      .mockReturnValueOnce({ kind: 'valid', fence })
      .mockReturnValueOnce({ kind: 'valid', fence })
      .mockReturnValue({ kind: 'missing' })
    mocks.stat.mockReturnValue({ mtimeMs: fence.createdAt + 1_000 })
    vi.useFakeTimers()

    const run = runMacUpdateInstallFenceMonitor(fence.attemptId)
    await vi.advanceTimersByTimeAsync(3_000)

    await expect(run).resolves.toBe(0)
    expect(mocks.diagnostic).not.toHaveBeenCalledWith(
      'mac_update_fence_recovered',
      expect.anything(),
      expect.anything()
    )
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it('transitions to installing when a matching ShipIt appears', async () => {
    const fence = createFence({ phase: 'awaiting-shipit' })
    mocks.installedVersion = fence.sourceVersion
    mocks.read
      .mockReturnValueOnce({ kind: 'valid', fence })
      .mockReturnValueOnce({ kind: 'valid', fence })
      .mockReturnValue({ kind: 'missing' })
    mocks.shipItAlive.mockResolvedValue(true)
    vi.useFakeTimers()

    const run = runMacUpdateInstallFenceMonitor(fence.attemptId)
    await vi.advanceTimersByTimeAsync(3_000)

    await expect(run).resolves.toBe(0)
    const transition = (mocks.update.mock.calls as unknown[][])
      .map((call) => call[1])
      .filter(
        (updater): updater is (current: MacUpdateInstallFence) => MacUpdateInstallFence =>
          typeof updater === 'function'
      )
      .map((updater) => updater(fence))
      .find((updated) => updated.phase === 'installing')
    expect(transition).toMatchObject({ phase: 'installing' })
    expect(transition?.shipItSeenAt).toBeTypeOf('number')
    expect(mocks.diagnostic).toHaveBeenCalledWith(
      'mac_update_fence_shipit_seen',
      expect.objectContaining({ attemptId: fence.attemptId }),
      expect.anything()
    )
  })

  it('confirms sustained ShipIt absence before declaring the installer gone', async () => {
    const fence = createFence({ phase: 'installing' })
    mocks.installedVersion = fence.sourceVersion
    mocks.read.mockReturnValue({ kind: 'valid', fence })
    mocks.shipItAlive.mockResolvedValue(false)
    vi.useFakeTimers()

    const run = runMacUpdateInstallFenceMonitor(fence.attemptId)
    await vi.advanceTimersByTimeAsync(20_000)

    await expect(run).resolves.toBe(0)
    expect(mocks.diagnostic).toHaveBeenCalledWith(
      'mac_update_fence_recovered',
      expect.objectContaining({ reason: 'installer_exited_without_target' }),
      expect.anything()
    )
    expect(mocks.remove).toHaveBeenCalledWith(fence.attemptId, expect.anything())
    expect(mocks.spawn).toHaveBeenCalledWith(
      '/usr/bin/open',
      [fence.targetBundlePath],
      expect.objectContaining({ detached: true })
    )
  })

  it('recovers from an aborted install within the abort bound despite a current state plist', async () => {
    // Field-observed abort fingerprint: ShipIt exits, the target is not
    // installed, and ShipItState.plist stays behind with a current mtime.
    const fence = createFence({ phase: 'installing' })
    mocks.installedVersion = fence.sourceVersion
    mocks.read.mockReturnValue({ kind: 'valid', fence })
    mocks.shipItAlive.mockResolvedValue(false)
    mocks.stat.mockReturnValue({ mtimeMs: fence.createdAt + 1_000 })
    vi.useFakeTimers()

    const run = runMacUpdateInstallFenceMonitor(fence.attemptId)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(mocks.remove).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(75_000)
    await expect(run).resolves.toBe(0)
    expect(mocks.diagnostic).toHaveBeenCalledWith(
      'mac_update_fence_recovered',
      expect.objectContaining({ reason: 'installer_exited_without_target' }),
      expect.anything()
    )
    expect(mocks.remove).toHaveBeenCalledWith(fence.attemptId, expect.anything())
    expect(mocks.spawn).toHaveBeenCalledWith(
      '/usr/bin/open',
      [fence.targetBundlePath],
      expect.objectContaining({ detached: true })
    )
  })

  it('bounds the current-plist extension when ShipIt never appears', async () => {
    const fence = createFence({
      phase: 'awaiting-shipit',
      lastTransitionAt: Date.now() - 121_000
    })
    mocks.installedVersion = fence.sourceVersion
    mocks.read.mockReturnValue({ kind: 'valid', fence })
    mocks.stat.mockReturnValue({ mtimeMs: fence.createdAt + 1_000 })
    vi.useFakeTimers()

    const run = runMacUpdateInstallFenceMonitor(fence.attemptId)
    await vi.advanceTimersByTimeAsync(92_000)

    await expect(run).resolves.toBe(0)
    expect(mocks.diagnostic).toHaveBeenCalledWith(
      'mac_update_fence_recovered',
      expect.objectContaining({ reason: 'shipit_not_seen' }),
      expect.anything()
    )
    // ShipIt never ran, so nothing gets relaunched (a quit-armed fence must
    // not resurrect an app the user deliberately quit).
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('recovers at the absolute deadline even while state remains on disk', async () => {
    const fence = createFence({ phase: 'installing', absoluteExpiresAt: Date.now() - 1 })
    mocks.installedVersion = fence.sourceVersion
    mocks.read.mockReturnValue({ kind: 'valid', fence })
    mocks.stat.mockReturnValue({ mtimeMs: fence.createdAt + 1_000 })

    await expect(runMacUpdateInstallFenceMonitor(fence.attemptId)).resolves.toBe(0)

    expect(mocks.diagnostic).toHaveBeenCalledWith(
      'mac_update_fence_recovered',
      expect.objectContaining({ reason: 'absolute_timeout' }),
      expect.anything()
    )
    expect(mocks.remove).toHaveBeenCalledWith(fence.attemptId, expect.anything())
  })

  it('keeps the fence past the absolute deadline while a matching ShipIt still runs', async () => {
    const fence = createFence({ phase: 'installing', absoluteExpiresAt: Date.now() + 500 })
    mocks.installedVersion = fence.sourceVersion
    mocks.read
      .mockReturnValueOnce({ kind: 'valid', fence })
      .mockReturnValueOnce({ kind: 'valid', fence })
      .mockReturnValueOnce({ kind: 'valid', fence })
      .mockReturnValue({ kind: 'missing' })
    mocks.shipItAlive.mockResolvedValue(true)
    vi.useFakeTimers()

    const run = runMacUpdateInstallFenceMonitor(fence.attemptId)
    await vi.advanceTimersByTimeAsync(5_000)

    await expect(run).resolves.toBe(0)
    // A slow install must not be unfenced mid-swap; ShipIt's exit is the bound.
    expect(mocks.diagnostic).not.toHaveBeenCalledWith(
      'mac_update_fence_recovered',
      expect.objectContaining({ reason: 'absolute_timeout' }),
      expect.anything()
    )
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it('retries a transient unreadable fence read instead of exiting', async () => {
    const fence = createFence({ phase: 'armed' })
    mocks.read
      .mockReturnValueOnce({ kind: 'valid', fence })
      .mockReturnValueOnce({ kind: 'valid', fence })
      .mockReturnValueOnce({ kind: 'unreadable' })
      .mockReturnValueOnce({ kind: 'valid', fence })
      .mockReturnValue({ kind: 'missing' })
    vi.useFakeTimers()

    const run = runMacUpdateInstallFenceMonitor(fence.attemptId)
    await vi.advanceTimersByTimeAsync(6_000)

    await expect(run).resolves.toBe(0)
    // The unreadable tick must not be treated as fence removal: the loop kept
    // reading (reaching the later valid + missing reads) and never cleaned up.
    expect(mocks.read.mock.calls.length).toBeGreaterThanOrEqual(5)
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it('exits quietly when the heartbeat loses fence ownership', async () => {
    const fence = createFence({ phase: 'armed' })
    mocks.read.mockReturnValue({ kind: 'valid', fence })
    mocks.update.mockReturnValueOnce(true).mockReturnValue(false)

    await expect(runMacUpdateInstallFenceMonitor(fence.attemptId)).resolves.toBe(0)

    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it('survives transient probe failures instead of dying mid-install', async () => {
    const fence = createFence({ phase: 'armed' })
    mocks.read
      .mockReturnValueOnce({ kind: 'valid', fence })
      .mockReturnValueOnce({ kind: 'valid', fence })
      .mockReturnValueOnce({ kind: 'valid', fence })
      .mockReturnValue({ kind: 'missing' })
    mocks.sourceAlive.mockRejectedValueOnce(new Error('ps fork failure')).mockResolvedValue(true)
    vi.useFakeTimers()

    const run = runMacUpdateInstallFenceMonitor(fence.attemptId)
    await vi.advanceTimersByTimeAsync(5_000)

    await expect(run).resolves.toBe(0)
    expect(mocks.remove).not.toHaveBeenCalled()
    expect(mocks.sourceAlive.mock.calls.length).toBeGreaterThan(1)
  })
})
