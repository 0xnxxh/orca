import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as MacUpdateFenceModule from '../../shared/mac-update-install-fence'
import type { MacUpdateInstallFence } from '../../shared/mac-update-install-fence'

const mocks = vi.hoisted(() => ({
  app: {
    isPackaged: true,
    getVersion: vi.fn(() => '1.0.0'),
    quit: vi.fn()
  },
  spawn: vi.fn(() => ({ unref: vi.fn() })),
  readPlistValue: vi.fn(() => 'com.stablyai.orca'),
  read: vi.fn(),
  remove: vi.fn(),
  removeInvalid: vi.fn(),
  diagnostic: vi.fn(),
  canonicalize: vi.fn((value: string) => value),
  monitorAlive: vi.fn(() => false),
  shipItAlive: vi.fn(() => false),
  shipItEvidence: vi.fn(() => false),
  readProcessTable: vi.fn(() => [])
}))

vi.mock('electron', () => ({ app: mocks.app }))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))
vi.mock('../mac-bundle-plist', () => ({ readMacBundlePlistValueSync: mocks.readPlistValue }))
vi.mock('../mac-update-install-fence-storage', () => ({
  canonicalizeMacUpdatePath: mocks.canonicalize,
  readMacUpdateInstallFence: mocks.read,
  removeInvalidMacUpdateInstallFence: mocks.removeInvalid,
  removeMacUpdateInstallFence: mocks.remove
}))
vi.mock('../mac-update-install-fence-diagnostics', () => ({
  writeMacUpdateFenceDiagnostic: mocks.diagnostic
}))
vi.mock('../mac-update-install-processes', () => ({
  hasCurrentShipItStateEvidence: mocks.shipItEvidence,
  hasFenceMonitorIdentity: mocks.monitorAlive,
  hasMatchingShipItProcess: mocks.shipItAlive,
  readMacProcessTableSync: mocks.readProcessTable
}))
// Why: the stale-lease grace is a blocking Atomics.wait; a zero grace keeps
// the re-evaluation tests from sleeping for real.
vi.mock('../../shared/mac-update-install-fence', async (importOriginal) => ({
  ...(await importOriginal<typeof MacUpdateFenceModule>()),
  MAC_UPDATE_FENCE_RECOVERY_GRACE_MS: 0
}))

import { runMacUpdateInstallFenceStartupGate } from './mac-update-install-fence-gate'

const NOW = Date.now()
const FENCE: MacUpdateInstallFence = {
  schemaVersion: 1,
  attemptId: '33943045-9dbf-47f3-a010-a25f1a5b0cbd',
  bundleIdentifier: 'com.stablyai.orca',
  sourceVersion: '1.0.0',
  targetVersion: '1.0.1',
  targetBundlePath: '/Applications/Orca.app',
  shipItStatePath: '/tmp/com.stablyai.orca.ShipIt/ShipItState.plist',
  sourcePid: 100,
  monitorPid: 101,
  phase: 'awaiting-shipit',
  createdAt: NOW - 1_000,
  heartbeatAt: NOW,
  lastTransitionAt: NOW,
  absoluteExpiresAt: NOW + 30 * 60_000
}

const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
const execPathDescriptor = Object.getOwnPropertyDescriptor(process, 'execPath')

describe('mac update install startup gate', () => {
  beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    Object.defineProperty(process, 'execPath', {
      configurable: true,
      value: '/Applications/Orca.app/Contents/MacOS/Orca'
    })
    mocks.app.getVersion.mockReset().mockReturnValue('1.0.0')
    mocks.app.quit.mockReset()
    mocks.spawn.mockReset().mockReturnValue({ unref: vi.fn() })
    mocks.readPlistValue.mockReset().mockReturnValue('com.stablyai.orca')
    mocks.read.mockReset().mockReturnValue({ kind: 'valid', fence: FENCE })
    mocks.remove.mockReset()
    mocks.removeInvalid.mockReset()
    mocks.diagnostic.mockReset()
    mocks.monitorAlive.mockReset().mockReturnValue(false)
    mocks.shipItAlive.mockReset().mockReturnValue(false)
    mocks.shipItEvidence.mockReset().mockReturnValue(false)
    mocks.readProcessTable.mockReset().mockReturnValue([])
  })

  afterEach(() => {
    if (platformDescriptor) {
      Object.defineProperty(process, 'platform', platformDescriptor)
    }
    if (execPathDescriptor) {
      Object.defineProperty(process, 'execPath', execPathDescriptor)
    }
    vi.restoreAllMocks()
  })

  it('quits an old source build before loading the application graph', () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    expect(runMacUpdateInstallFenceStartupGate()).toBe(false)
    expect(mocks.app.quit).toHaveBeenCalledOnce()
    expect(mocks.remove).not.toHaveBeenCalled()
    expect(mocks.diagnostic).toHaveBeenCalledWith(
      'mac_update_fence_launch_blocked',
      expect.objectContaining({ phase: 'awaiting-shipit' })
    )
  })

  it('shows a detached blocked-launch notice so Dock launches are not silent', () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    expect(runMacUpdateInstallFenceStartupGate()).toBe(false)
    // Why detached osascript: in-process UI would keep this LaunchServices
    // process alive and could abort ShipIt's running-instances check.
    expect(mocks.spawn).toHaveBeenCalledWith(
      '/usr/bin/osascript',
      expect.arrayContaining([expect.stringContaining('1.0.1')]),
      expect.objectContaining({ detached: true })
    )
  })

  it('lets the installed target start and claims only its attempt', () => {
    mocks.app.getVersion.mockReturnValue('1.0.1')

    expect(runMacUpdateInstallFenceStartupGate()).toBe(true)
    expect(mocks.app.quit).not.toHaveBeenCalled()
    expect(mocks.remove).toHaveBeenCalledWith(FENCE.attemptId)
  })

  it('fails open and removes malformed state best-effort', () => {
    mocks.read.mockReturnValue({ kind: 'invalid', reason: 'malformed' })

    expect(runMacUpdateInstallFenceStartupGate()).toBe(true)
    expect(mocks.removeInvalid).toHaveBeenCalledOnce()
    expect(mocks.app.quit).not.toHaveBeenCalled()
  })

  it('evaluates a fresh attempt armed during the stale-lease grace instead of failing open', () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const staleFence: MacUpdateInstallFence = {
      ...FENCE,
      heartbeatAt: NOW - 60_000,
      phase: 'armed'
    }
    const freshFence: MacUpdateInstallFence = {
      ...FENCE,
      attemptId: 'aa943045-9dbf-47f3-a010-a25f1a5b0cbd',
      heartbeatAt: Date.now()
    }
    mocks.read
      .mockReturnValueOnce({ kind: 'valid', fence: staleFence })
      .mockReturnValue({ kind: 'valid', fence: freshFence })

    expect(runMacUpdateInstallFenceStartupGate()).toBe(false)
    expect(mocks.app.quit).toHaveBeenCalledOnce()
    expect(mocks.diagnostic).toHaveBeenCalledWith(
      'mac_update_fence_launch_blocked',
      expect.objectContaining({ attemptId: freshFence.attemptId })
    )
  })

  it('keeps an unknown-schema fence while failing open', () => {
    mocks.read.mockReturnValue({ kind: 'invalid', reason: 'unknown_schema' })

    expect(runMacUpdateInstallFenceStartupGate()).toBe(true)
    // A newer app owns that fence; deleting state we cannot interpret could
    // abort its install.
    expect(mocks.removeInvalid).not.toHaveBeenCalled()
    expect(mocks.app.quit).not.toHaveBeenCalled()
  })

  it('probes instead of trusting a clock-clamped future heartbeat', () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const futureFence: MacUpdateInstallFence = {
      ...FENCE,
      heartbeatAt: Date.now() + 10 * 60_000
    }
    mocks.read.mockReturnValue({ kind: 'valid', fence: futureFence })

    expect(runMacUpdateInstallFenceStartupGate()).toBe(true)
    // Dead monitor + no ShipIt: fail open instead of blocking for the whole
    // backward clock step.
    expect(mocks.readProcessTable).toHaveBeenCalled()
    expect(mocks.remove).toHaveBeenCalledWith(futureFence.attemptId)
    expect(mocks.app.quit).not.toHaveBeenCalled()

    mocks.remove.mockClear()
    mocks.app.quit.mockClear()
    mocks.monitorAlive.mockReturnValue(true)
    expect(runMacUpdateInstallFenceStartupGate()).toBe(false)
    expect(mocks.app.quit).toHaveBeenCalledOnce()
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it('falls back to plist evidence when ps fails during stale probes', () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const staleFence: MacUpdateInstallFence = {
      ...FENCE,
      heartbeatAt: Date.now() - 60_000
    }
    mocks.read.mockReturnValue({ kind: 'valid', fence: staleFence })
    mocks.readProcessTable.mockImplementation(() => {
      throw new Error('ps fork failure')
    })
    mocks.shipItEvidence.mockReturnValue(true)

    // A failed ps must not remove the fence out from under a live ShipIt.
    expect(runMacUpdateInstallFenceStartupGate()).toBe(false)
    expect(mocks.app.quit).toHaveBeenCalledOnce()
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it('honors the kill switch for enforcement, not just arming', () => {
    process.env.ORCA_DISABLE_MAC_UPDATE_INSTALL_FENCE = '1'
    try {
      expect(runMacUpdateInstallFenceStartupGate()).toBe(true)
      expect(mocks.read).not.toHaveBeenCalled()
      expect(mocks.app.quit).not.toHaveBeenCalled()
    } finally {
      delete process.env.ORCA_DISABLE_MAC_UPDATE_INSTALL_FENCE
    }
  })
})
