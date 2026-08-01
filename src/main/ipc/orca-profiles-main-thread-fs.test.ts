// Regression guard for the app-freeze class: a synchronous fs syscall on the
// Electron main thread. When userData sits on a stalled SMB/NFS mount, mkdirSync
// enters an uninterruptible wait and the app stops repainting (freeze #36), and
// orcaProfiles:list sits on the app-startup chain.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as NodeFs from 'node:fs'
import type * as NodeFsPromises from 'node:fs/promises'
import type { GlobalSettings } from '../../shared/types'
import type {
  createLocalOrcaProfile,
  ensureActiveOrcaProfile,
  seedNewOrcaProfileTelemetryConsentAsync
} from '../orca-profiles/profile-index-store'

type ProfileIndexStoreModule = {
  createLocalOrcaProfile: typeof createLocalOrcaProfile
  ensureActiveOrcaProfile: typeof ensureActiveOrcaProfile
  seedNewOrcaProfileTelemetryConsentAsync: typeof seedNewOrcaProfileTelemetryConsentAsync
}

/** One-shot park on a named fs op, so a test can interleave a sync writer. */
type FsHold = { op: string; entered: () => void; release: Promise<void> }

const {
  syncFsCalls,
  asyncFsCalls,
  gate,
  userData,
  relaunchAppMock,
  RECORDED_SYNC,
  RECORDED_ASYNC
} = vi.hoisted(() => ({
  syncFsCalls: [] as string[],
  asyncFsCalls: [] as string[],
  gate: { block: null as Promise<void> | null, hold: null as FsHold | null },
  userData: { dir: '' },
  relaunchAppMock: vi.fn(),
  RECORDED_SYNC: [
    'accessSync',
    'copyFileSync',
    'existsSync',
    'mkdirSync',
    'readFileSync',
    'renameSync',
    'statSync',
    'unlinkSync',
    'writeFileSync'
  ] as const,
  RECORDED_ASYNC: [
    'access',
    'copyFile',
    'mkdir',
    'readFile',
    'rename',
    'stat',
    'unlink',
    'writeFile'
  ] as const
}))

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof NodeFs>('node:fs')
  const patched: Record<string, unknown> = { ...actual }
  for (const name of RECORDED_SYNC) {
    const real = actual[name] as (...args: unknown[]) => unknown
    patched[name] = (...args: unknown[]) => {
      syncFsCalls.push(`${name} ${String(args[0])}`)
      return real(...args)
    }
  }
  return patched
})

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
  const patched: Record<string, unknown> = { ...actual }
  for (const name of RECORDED_ASYNC) {
    const real = actual[name] as (...args: unknown[]) => Promise<unknown>
    patched[name] = async (...args: unknown[]) => {
      asyncFsCalls.push(`${name} ${String(args[0])}`)
      const hold = gate.hold
      if (hold?.op === name) {
        gate.hold = null
        hold.entered()
        await hold.release
      }
      if (gate.block) {
        await gate.block
      }
      return real(...args)
    }
  }
  return patched
})

const handlers = new Map<string, (event: unknown, args?: unknown) => unknown>()

vi.mock('electron', () => ({
  app: {
    getPath: () => userData.dir,
    quit: vi.fn(),
    relaunch: vi.fn()
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (event: unknown, args?: unknown) => unknown) => {
      handlers.set(channel, handler)
    })
  }
}))

vi.mock('../app-relaunch', () => ({ relaunchApp: relaunchAppMock }))
vi.mock('./orca-profile-org-members-handlers', () => ({
  registerOrcaProfileOrgMemberHandlers: vi.fn()
}))
vi.mock('../orca-profiles/profile-cloud-service', () => ({
  createCloudLinkedOrcaProfile: vi.fn(),
  connectCurrentOrcaProfile: vi.fn(),
  getCurrentOrcaProfileAuthStatus: vi.fn(),
  refreshCurrentOrcaProfileAuth: vi.fn(),
  selectCurrentOrcaProfileOrg: vi.fn(),
  signOutCurrentOrcaProfile: vi.fn()
}))
vi.mock('../orca-profiles/profile-cloud-session-mutation', () => ({
  cloudSessionIdentity: vi.fn(),
  recordCloudSessionIdentityMutation: vi.fn()
}))
vi.mock('../orca-profiles/profile-project-transfer', () => ({
  transferOrcaProfileProject: vi.fn()
}))
vi.mock('../orca-profiles/profile-project-presence', () => ({
  findOrcaProfileProjectsByPath: vi.fn()
}))

function makeStore(settings: Partial<GlobalSettings>): {
  flush: () => void
  freezeWrites: () => void
  getSettings: () => Partial<GlobalSettings>
} {
  return { flush: vi.fn(), freezeWrites: vi.fn(), getSettings: () => settings }
}

async function loadHandlers(
  settings: Partial<GlobalSettings> = {}
): Promise<ProfileIndexStoreModule> {
  vi.resetModules()
  handlers.clear()
  const store = await import('../orca-profiles/profile-index-store')
  const { registerOrcaProfileHandlers } = await import('./orca-profiles')
  registerOrcaProfileHandlers(makeStore(settings) as never)
  return store
}

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

function readIndexProfileIds(): string[] {
  const index = JSON.parse(
    readFileSync(join(userData.dir, 'orca-profile-index.json'), 'utf-8')
  ) as { profiles: { id: string }[] }
  return index.profiles.map((profile) => profile.id)
}

function invoke(channel: string, args?: unknown): Promise<unknown> {
  const handler = handlers.get(channel)
  if (!handler) {
    throw new Error(`no handler for ${channel}`)
  }
  return Promise.resolve(handler(null, args))
}

function resetRecorders(): void {
  syncFsCalls.length = 0
  asyncFsCalls.length = 0
}

describe('orca profile IPC handlers stay off main-thread sync fs', () => {
  beforeEach(() => {
    userData.dir = mkdtempSync(join(tmpdir(), 'orca-profile-freeze-'))
    gate.block = null
    gate.hold = null
    resetRecorders()
    relaunchAppMock.mockReset()
  })

  afterEach(() => {
    gate.block = null
    gate.hold = null
    rmSync(userData.dir, { recursive: true, force: true })
  })

  it('answers orcaProfiles:list from the boot-resolved index with zero fs syscalls', async () => {
    const { ensureActiveOrcaProfile } = await loadHandlers()
    ensureActiveOrcaProfile()
    resetRecorders()

    const result = (await invoke('orcaProfiles:list')) as { activeProfileId: string }

    expect(result.activeProfileId).toBeTruthy()
    expect(syncFsCalls).toEqual([])
    expect(asyncFsCalls).toEqual([])
  })

  it('creates a local profile without a synchronous fs call', async () => {
    const { ensureActiveOrcaProfile } = await loadHandlers()
    ensureActiveOrcaProfile()
    resetRecorders()

    const created = (await invoke('orcaProfiles:createLocal', { name: 'Work' })) as {
      profile: { id: string }
      profiles: { id: string }[]
    }

    expect(created.profiles.map((profile) => profile.id)).toContain(created.profile.id)
    expect(syncFsCalls).toEqual([])
    expect(asyncFsCalls.some((call) => call.startsWith('mkdir '))).toBe(true)
  })

  it('switches the active profile without a synchronous fs call', async () => {
    const { ensureActiveOrcaProfile } = await loadHandlers()
    ensureActiveOrcaProfile()
    const created = (await invoke('orcaProfiles:createLocal', { name: 'Work' })) as {
      profile: { id: string }
    }
    resetRecorders()

    await expect(invoke('orcaProfiles:switch', { profileId: created.profile.id })).resolves.toEqual(
      { status: 'relaunching' }
    )

    expect(syncFsCalls).toEqual([])
  })

  it('serializes overlapping profile creates so neither index write is lost', async () => {
    const { ensureActiveOrcaProfile } = await loadHandlers()
    ensureActiveOrcaProfile()

    const [first, second] = (await Promise.all([
      invoke('orcaProfiles:createLocal', { name: 'One' }),
      invoke('orcaProfiles:createLocal', { name: 'Two' })
    ])) as { profile: { id: string } }[]

    const listed = (await invoke('orcaProfiles:list')) as { profiles: { id: string }[] }
    const ids = listed.profiles.map((profile) => profile.id)
    expect(ids).toContain(first.profile.id)
    expect(ids).toContain(second.profile.id)
  })

  it('keeps the event loop running while a profile index write is parked', async () => {
    const { ensureActiveOrcaProfile } = await loadHandlers()
    ensureActiveOrcaProfile()
    resetRecorders()
    gate.block = new Promise<void>(() => {})

    const parked = invoke('orcaProfiles:createLocal', { name: 'Stalled mount' })
    let settled = false
    void parked.then(() => {
      settled = true
    })

    let timerFired = false
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        timerFired = true
        resolve()
      }, 5)
    })

    expect(timerFired).toBe(true)
    expect(settled).toBe(false)
    expect(syncFsCalls).toEqual([])
  })

  it('lets a sync index write veto an async write already parked on rename', async () => {
    const store = await loadHandlers()
    store.ensureActiveOrcaProfile()

    const entered = createDeferred()
    const release = createDeferred()
    gate.hold = { op: 'rename', entered: entered.resolve, release: release.promise }

    const pending = invoke('orcaProfiles:createLocal', { name: 'Async' }) as Promise<{
      profile: { id: string }
    }>
    await entered.promise

    // The sync twin (startup, cloud index) still writes this file directly.
    const synced = store.createLocalOrcaProfile({ name: 'Sync' })
    release.resolve()
    const created = await pending

    expect(readIndexProfileIds()).toEqual(
      expect.arrayContaining([synced.profile.id, created.profile.id])
    )
    // The zero-fs list cache must not be left holding the pre-sync index.
    const listed = (await invoke('orcaProfiles:list')) as { profiles: { id: string }[] }
    expect(listed.profiles.map((profile) => profile.id)).toEqual(
      expect.arrayContaining([synced.profile.id, created.profile.id])
    )
  })

  it('seeds new-profile telemetry consent through a temp file, never in place', async () => {
    const telemetry = {
      optedIn: false,
      installId: 'install-1',
      existedBeforeTelemetryRelease: true
    }
    const { ensureActiveOrcaProfile } = await loadHandlers({ telemetry })
    ensureActiveOrcaProfile()
    resetRecorders()

    const created = (await invoke('orcaProfiles:createLocal', { name: 'Work' })) as {
      profile: { id: string }
    }

    const dataFile = join(userData.dir, 'profiles', created.profile.id, 'orca-data.json')
    expect(syncFsCalls).toEqual([])
    // A torn in-place write would leave partial JSON at the real path.
    expect(asyncFsCalls).not.toContain(`writeFile ${dataFile}`)
    expect(asyncFsCalls).toContain(`writeFile ${dataFile}.async.tmp`)
    expect(asyncFsCalls).toContain(`rename ${dataFile}.async.tmp`)
    expect(JSON.parse(readFileSync(dataFile, 'utf-8'))).toEqual({ settings: { telemetry } })
  })

  it('leaves an existing profile data file untouched when seeding telemetry consent', async () => {
    const telemetry = {
      optedIn: true,
      installId: 'install-2',
      existedBeforeTelemetryRelease: false
    }
    const store = await loadHandlers({ telemetry })
    store.ensureActiveOrcaProfile()
    const { seedNewOrcaProfileTelemetryConsentAsync } = store
    const created = (await invoke('orcaProfiles:createLocal', { name: 'Work' })) as {
      profile: { id: string }
    }
    const dataFile = join(userData.dir, 'profiles', created.profile.id, 'orca-data.json')

    await seedNewOrcaProfileTelemetryConsentAsync(created.profile.id, {
      ...telemetry,
      installId: 'install-overwrite'
    })

    expect(JSON.parse(readFileSync(dataFile, 'utf-8'))).toEqual({ settings: { telemetry } })
  })
})
