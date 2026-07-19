import { EventEmitter } from 'node:events'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MacUpdateInstallFence } from '../shared/mac-update-install-fence'

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  existsSync: vi.fn(() => true),
  canonicalize: vi.fn((value: string) => value),
  create: vi.fn(),
  read: vi.fn(),
  remove: vi.fn(),
  removeInvalid: vi.fn(),
  update: vi.fn(() => true),
  shipItStatePath: vi.fn(
    () => '/Users/test/Library/Caches/com.stablyai.orca.ShipIt/ShipItState.plist'
  ),
  blocker: vi.fn(async () => null),
  monitorAlive: vi.fn(() => false),
  shipItAlive: vi.fn(() => false),
  track: vi.fn()
}))

vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))
vi.mock('node:fs', () => ({ existsSync: mocks.existsSync }))
vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getVersion: vi.fn(() => '1.0.0'),
    getAppPath: vi.fn(() => '/Applications/Orca.app/Contents/Resources/app.asar')
  }
}))
vi.mock('./mac-update-install-fence-storage', () => {
  // Why: importing the real storage module would drag its full node:fs surface
  // into this test's narrow fs mock; only the error identity is needed.
  class MacUpdateFenceAlreadyExistsError extends Error {}
  return {
    MacUpdateFenceAlreadyExistsError,
    canonicalizeMacUpdatePath: mocks.canonicalize,
    createMacUpdateInstallFence: mocks.create,
    getMacShipItStatePath: mocks.shipItStatePath,
    readMacUpdateInstallFence: mocks.read,
    removeInvalidMacUpdateInstallFence: mocks.removeInvalid,
    removeMacUpdateInstallFence: mocks.remove,
    updateMacUpdateInstallFence: mocks.update
  }
})
vi.mock('./mac-update-install-processes', () => ({
  findMacProductionProcessBlocker: mocks.blocker,
  getMacUpdateFenceMonitorMarker: () => '--orca-update-fence-monitor',
  isFenceMonitorIdentityAliveSync: mocks.monitorAlive,
  isMatchingShipItProcessAliveSync: mocks.shipItAlive
}))
vi.mock('./mac-update-install-fence-telemetry', () => ({
  trackMacUpdateFenceEvent: mocks.track
}))

import { MacUpdateFenceAlreadyExistsError } from './mac-update-install-fence-storage'
import { armMacUpdateInstallFence } from './mac-update-install-fence-controller'

const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
const execPathDescriptor = Object.getOwnPropertyDescriptor(process, 'execPath')

type FakeMonitor = EventEmitter & {
  pid: number
  kill: ReturnType<typeof vi.fn>
  unref: ReturnType<typeof vi.fn>
  channel?: undefined
}

function createFakeMonitor(args: readonly string[]): FakeMonitor {
  const monitor = new EventEmitter() as FakeMonitor
  monitor.pid = 4242
  monitor.kill = vi.fn()
  monitor.unref = vi.fn()
  const attemptId = args[2]
  setImmediate(() => {
    monitor.emit('message', { type: 'mac-update-fence-monitor-ready', attemptId })
  })
  return monitor
}

function createExistingFence(
  overrides: Partial<MacUpdateInstallFence> = {}
): MacUpdateInstallFence {
  const now = Date.now()
  return {
    schemaVersion: 1,
    attemptId: 'c26cc09d-53f2-4b32-8f6c-64eeeb0e21ad',
    bundleIdentifier: 'com.stablyai.orca',
    sourceVersion: '1.0.0',
    targetVersion: '1.0.1',
    targetBundlePath: '/Applications/Orca.app',
    shipItStatePath: '/Users/test/Library/Caches/com.stablyai.orca.ShipIt/ShipItState.plist',
    sourcePid: 100,
    monitorPid: 101,
    phase: 'armed',
    createdAt: now - 120_000,
    heartbeatAt: now - 60_000,
    lastTransitionAt: now - 120_000,
    absoluteExpiresAt: now + 20 * 60_000,
    ...overrides
  }
}

beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'darwin' })
  Object.defineProperty(process, 'execPath', {
    configurable: true,
    value: '/Applications/Orca.app/Contents/MacOS/Orca'
  })
  mocks.spawn
    .mockReset()
    .mockImplementation((_command: string, args: readonly string[]) => createFakeMonitor(args))
  mocks.existsSync.mockReset().mockReturnValue(true)
  mocks.create.mockReset()
  mocks.read.mockReset().mockReturnValue({ kind: 'missing' })
  mocks.remove.mockReset()
  mocks.removeInvalid.mockReset()
  mocks.update.mockReset().mockReturnValue(true)
  mocks.monitorAlive.mockReset().mockReturnValue(false)
  mocks.shipItAlive.mockReset().mockReturnValue(false)
  mocks.track.mockReset()
})

afterAll(() => {
  if (platformDescriptor) {
    Object.defineProperty(process, 'platform', platformDescriptor)
  }
  if (execPathDescriptor) {
    Object.defineProperty(process, 'execPath', execPathDescriptor)
  }
})

describe('mac update install fence arming', () => {
  it('refuses to write a fence with an unparseable target version', async () => {
    // Why: such a fence reads back as malformed everywhere — the monitor can
    // never own it and the error path cannot remove it.
    await expect(armMacUpdateInstallFence('')).rejects.toThrow('parseable target version')
    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('reclaims an abandoned stale fence so in-session retries can arm', async () => {
    const abandoned = createExistingFence()
    mocks.read.mockReturnValue({ kind: 'valid', fence: abandoned })

    const handle = await armMacUpdateInstallFence('1.0.2')

    expect(mocks.remove).toHaveBeenCalledWith(abandoned.attemptId)
    expect(mocks.create).toHaveBeenCalledOnce()
    expect(handle?.targetVersion).toBe('1.0.2')
  })

  it('reclaims an abandoned fence with a clock-clamped future heartbeat', async () => {
    // Why: after a backward clock step a dead attempt's heartbeat reads as
    // "fresh forever"; without probes here every in-session retry would EEXIST.
    const abandoned = createExistingFence({ heartbeatAt: Date.now() + 10 * 60_000 })
    mocks.read.mockReturnValue({ kind: 'valid', fence: abandoned })

    const handle = await armMacUpdateInstallFence('1.0.2')

    expect(mocks.remove).toHaveBeenCalledWith(abandoned.attemptId)
    expect(handle?.targetVersion).toBe('1.0.2')
  })

  it('keeps an unknown-schema fence and lets arming fail over to unfenced', async () => {
    mocks.read.mockReturnValue({ kind: 'invalid', reason: 'unknown_schema' })
    mocks.create.mockImplementation(() => {
      throw new MacUpdateFenceAlreadyExistsError()
    })

    await expect(armMacUpdateInstallFence('1.0.2')).rejects.toBeInstanceOf(
      MacUpdateFenceAlreadyExistsError
    )
    // A newer app owns that fence; never delete state we cannot interpret.
    expect(mocks.removeInvalid).not.toHaveBeenCalled()
  })

  it('leaves a fresh fence alone and fails the retry loudly', async () => {
    const active = createExistingFence({ heartbeatAt: Date.now() })
    mocks.read.mockReturnValue({ kind: 'valid', fence: active })
    mocks.create.mockImplementation(() => {
      throw new MacUpdateFenceAlreadyExistsError()
    })

    await expect(armMacUpdateInstallFence('1.0.2')).rejects.toBeInstanceOf(
      MacUpdateFenceAlreadyExistsError
    )
    expect(mocks.remove).not.toHaveBeenCalledWith(active.attemptId)
  })

  it('keeps a stale fence whose installer is still alive', async () => {
    const evidenced = createExistingFence()
    mocks.read.mockReturnValue({ kind: 'valid', fence: evidenced })
    mocks.shipItAlive.mockReturnValue(true)
    mocks.create.mockImplementation(() => {
      throw new MacUpdateFenceAlreadyExistsError()
    })

    await expect(armMacUpdateInstallFence('1.0.2')).rejects.toBeInstanceOf(
      MacUpdateFenceAlreadyExistsError
    )
    expect(mocks.remove).not.toHaveBeenCalledWith(evidenced.attemptId)
  })
})
