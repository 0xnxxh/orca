import { access, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { MethodHandler, RequestContext } from './dispatcher'
import type { LegacyPhysicalWorkerControlHost } from './legacy-physical-worker-control-surface'
import { registerLegacyPhysicalWorkerControlSurface } from './legacy-physical-worker-control-surface'
import {
  LEGACY_PHYSICAL_WORKER_GC_METHOD,
  LEGACY_PHYSICAL_WORKER_MIGRATION_BARRIER_METHOD
} from './legacy-physical-worker-control-protocol'
import {
  assertLegacyRelayGcCandidatePath,
  defaultLegacyRelayGcFileSystem,
  type LegacyRelayGcFileSystem
} from './legacy-relay-gc-path-policy'
import { LegacyRelayPostMigrationGc } from './legacy-relay-post-migration-gc'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('legacy relay post-migration GC', () => {
  it('derives candidates from catalog eligibility after a durable restart-safe barrier', async () => {
    const root = await temporaryDirectory()
    const state = path.join(root, 'authority-state')
    const firstCandidate = await legacyRelayDirectory(root, 'legacy-a')
    const secondCandidate = await legacyRelayDirectory(root, 'legacy-b')
    let eligible = protection([firstCandidate])
    const input = {
      directory: state,
      catalogRevision: () => 9,
      protection: () => protection(),
      eligible: () => eligible,
      allowedRoots: [root]
    }
    const first = await LegacyRelayPostMigrationGc.open(input)

    await expect(first.collect({ barrierId: 'barrier-1' })).rejects.toThrow(
      'requires the durable migration barrier'
    )
    await first.commitBarrier({ barrierId: 'barrier-1', expectedCatalogRevision: 9 })
    await expect(first.collect({ barrierId: 'barrier-1' })).resolves.toMatchObject({
      removed: [firstCandidate]
    })

    eligible = protection([secondCandidate])
    const restarted = await LegacyRelayPostMigrationGc.open(input)
    await expect(restarted.collect({ barrierId: 'barrier-1' })).resolves.toMatchObject({
      removed: [secondCandidate]
    })
  })

  it('keeps a live old relay isolated when GC runs after migrationBarrier', async () => {
    const root = await temporaryDirectory()
    const state = path.join(root, 'authority-state')
    const liveOldRelay = await legacyRelayDirectory(root, 'relay-0.1.0+111111111111')
    const staleRelay = await legacyRelayDirectory(root, 'relay-0.1.0+222222222222')
    const liveProtection = () => protection([liveOldRelay])
    const eligible = () => protection([liveOldRelay, staleRelay])
    const host: LegacyPhysicalWorkerControlHost = {
      inspect: async () => {
        throw new Error('inspection is not part of this GC oracle')
      },
      migrate: async () => {
        throw new Error('migration is not part of this GC oracle')
      },
      gcProtection: liveProtection,
      catalogRevision: () => 7
    }
    const gc = await LegacyRelayPostMigrationGc.open({
      directory: state,
      catalogRevision: host.catalogRevision,
      protection: liveProtection,
      eligible,
      allowedRoots: [root]
    })
    const handlers = new Map<string, MethodHandler>()
    registerLegacyPhysicalWorkerControlSurface({
      dispatcher: { onRequest: (method, handler) => void handlers.set(method, handler) },
      host,
      gc,
      hasActiveClient: () => false,
      protection: liveProtection
    })

    await handlers.get(LEGACY_PHYSICAL_WORKER_MIGRATION_BARRIER_METHOD)!(
      { version: 1, barrierId: 'barrier-live-old-relay', expectedCatalogRevision: 7 },
      authenticatedControlContext
    )
    const result = await handlers.get(LEGACY_PHYSICAL_WORKER_GC_METHOD)!(
      { version: 1, barrierId: 'barrier-live-old-relay' },
      authenticatedControlContext
    )

    expect(result).toMatchObject({
      removed: [staleRelay],
      protected: { relayDirectories: expect.arrayContaining([liveOldRelay]) }
    })
    await expect(access(path.join(liveOldRelay, 'relay.sock'))).resolves.toBeUndefined()
    await expect(access(staleRelay)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('skips exact, ancestor, and descendant overlap with live protection', async () => {
    const root = await temporaryDirectory()
    const protectedRoot = await legacyRelayDirectory(root, 'protected-relay')
    const protectedChild = path.join(protectedRoot, 'relay.sock')
    await writeFile(protectedChild, 'live')
    const gc = await LegacyRelayPostMigrationGc.open({
      directory: path.join(root, 'authority-state'),
      catalogRevision: () => 2,
      protection: () => protection([protectedRoot], [protectedChild]),
      eligible: () => protection([protectedRoot], [protectedChild]),
      allowedRoots: [root]
    })
    await gc.commitBarrier({ barrierId: 'barrier-2', expectedCatalogRevision: 2 })

    await expect(gc.collect({ barrierId: 'barrier-2' })).resolves.toEqual({
      removed: [],
      protected: protection([protectedRoot], [protectedChild])
    })
    await expect(access(protectedChild)).resolves.toBeUndefined()
  })

  it('rejects roots, parents, siblings, and cross-platform path escapes', () => {
    const posixRoot = '/Users/alice/.orca-remote'
    expect(assertLegacyRelayGcCandidatePath(`${posixRoot}/relay-old`, [posixRoot])).toBe(
      `${posixRoot}/relay-old`
    )
    for (const candidate of [posixRoot, '/Users/alice', '/Users/alice/.orca-sibling', '/']) {
      expect(() => assertLegacyRelayGcCandidatePath(candidate, [posixRoot])).toThrow()
    }

    const windowsRoot = 'C:\\Users\\Alice\\.orca-remote'
    expect(assertLegacyRelayGcCandidatePath(`${windowsRoot}\\relay-old`, [windowsRoot])).toBe(
      `${windowsRoot}\\relay-old`
    )
    for (const candidate of [windowsRoot, 'C:\\Users\\Alice', 'D:\\relay-old', 'C:\\']) {
      expect(() => assertLegacyRelayGcCandidatePath(candidate, [windowsRoot])).toThrow()
    }

    const uncRoot = '\\\\server\\share\\.orca-remote'
    expect(assertLegacyRelayGcCandidatePath(`${uncRoot}\\relay-old`, [uncRoot])).toBe(
      `${uncRoot}\\relay-old`
    )
    expect(() =>
      assertLegacyRelayGcCandidatePath('\\\\server\\other\\relay-old', [uncRoot])
    ).toThrow()
  })

  it('rejects direct and intermediate symlink escapes before deletion', async () => {
    const root = await temporaryDirectory()
    const outside = await temporaryDirectory()
    const outsideCandidate = await legacyRelayDirectory(outside, 'outside-relay')
    const directLink = path.join(root, 'direct-link')
    const intermediateLink = path.join(root, 'intermediate-link')
    await symlink(outsideCandidate, directLink, process.platform === 'win32' ? 'junction' : 'dir')
    await symlink(outside, intermediateLink, process.platform === 'win32' ? 'junction' : 'dir')
    const eligibleDirectories = [directLink, path.join(intermediateLink, 'outside-relay')]
    const gc = await LegacyRelayPostMigrationGc.open({
      directory: path.join(root, 'authority-state'),
      catalogRevision: () => 3,
      protection: () => protection(),
      eligible: () => protection(eligibleDirectories),
      allowedRoots: [root]
    })
    await gc.commitBarrier({ barrierId: 'barrier-3', expectedCatalogRevision: 3 })

    await expect(gc.collect({ barrierId: 'barrier-3' })).rejects.toThrow(
      /unsafe|outside its authority-owned root/
    )
    await expect(access(path.join(outsideCandidate, 'relay.sock'))).resolves.toBeUndefined()
  })

  it('quarantines and preserves a pathname replacement at the rename boundary', async () => {
    const root = await temporaryDirectory()
    const state = path.join(root, 'authority-state')
    const candidate = await legacyRelayDirectory(root, 'legacy-replaced')
    const original = `${candidate}.original`
    let replaced = false
    const fileSystem: LegacyRelayGcFileSystem = {
      ...defaultLegacyRelayGcFileSystem,
      rename: async (source, target) => {
        if (source === candidate && !replaced) {
          replaced = true
          await defaultLegacyRelayGcFileSystem.rename(source, original)
          await mkdir(source)
          await writeFile(path.join(source, 'relay.sock'), 'replacement')
        }
        await defaultLegacyRelayGcFileSystem.rename(source, target)
      }
    }
    const input = {
      directory: state,
      catalogRevision: () => 4,
      protection: () => protection(),
      eligible: () => protection([candidate]),
      allowedRoots: [root],
      fileSystem
    }
    const gc = await LegacyRelayPostMigrationGc.open(input)
    await gc.commitBarrier({ barrierId: 'barrier-4', expectedCatalogRevision: 4 })

    const result = await gc.collect({ barrierId: 'barrier-4' })
    expect(result.removed).toEqual([])
    const quarantine = result.protected.relayDirectories.find((entry) =>
      entry.includes('.terminal-authority-gc-')
    )
    expect(quarantine).toBeDefined()
    await expect(readFile(path.join(original, 'relay.sock'), 'utf8')).resolves.toBe('old')
    await expect(readFile(path.join(quarantine!, 'relay.sock'), 'utf8')).resolves.toBe(
      'replacement'
    )

    const restarted = await LegacyRelayPostMigrationGc.open(input)
    await expect(restarted.collect({ barrierId: 'barrier-4' })).resolves.toMatchObject({
      removed: [],
      protected: { relayDirectories: expect.arrayContaining([candidate, quarantine!]) }
    })
  })

  it('durably preserves a candidate when live protection changes after quarantine', async () => {
    const root = await temporaryDirectory()
    const state = path.join(root, 'authority-state')
    const candidate = await legacyRelayDirectory(root, 'legacy-protected-late')
    let liveProtection = protection()
    const fileSystem: LegacyRelayGcFileSystem = {
      ...defaultLegacyRelayGcFileSystem,
      rename: async (source, target) => {
        await defaultLegacyRelayGcFileSystem.rename(source, target)
        if (source === candidate) {
          liveProtection = protection([candidate])
        }
      }
    }
    const input = {
      directory: state,
      catalogRevision: () => 5,
      protection: () => liveProtection,
      eligible: () => protection([candidate]),
      allowedRoots: [root],
      fileSystem
    }
    const gc = await LegacyRelayPostMigrationGc.open(input)
    await gc.commitBarrier({ barrierId: 'barrier-5', expectedCatalogRevision: 5 })

    const result = await gc.collect({ barrierId: 'barrier-5' })
    expect(result.removed).toEqual([])
    const quarantine = result.protected.relayDirectories.find((entry) =>
      entry.includes('.terminal-authority-gc-')
    )
    expect(quarantine).toBeDefined()
    expect(await readdir(quarantine!)).toContain('relay.sock')

    const restarted = await LegacyRelayPostMigrationGc.open(input)
    await expect(restarted.collect({ barrierId: 'barrier-5' })).resolves.toMatchObject({
      removed: [],
      protected: { relayDirectories: expect.arrayContaining([candidate, quarantine!]) }
    })
  })
})

function protection(relayDirectories: string[] = [], evidencePaths: string[] = []) {
  return Object.freeze({
    relayDirectories: Object.freeze([...relayDirectories]),
    evidencePaths: Object.freeze([...evidencePaths])
  })
}

async function legacyRelayDirectory(root: string, name: string): Promise<string> {
  const directory = path.join(root, name)
  await mkdir(directory)
  await writeFile(path.join(directory, 'relay.sock'), 'old')
  return directory
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'orca-legacy-gc-'))
  temporaryDirectories.push(directory)
  return directory
}

const authenticatedControlContext: RequestContext = Object.freeze({
  clientId: 1,
  isStale: () => false,
  sessionIdentity: Object.freeze({
    principal: 'terminal-authority:authority-1',
    authenticated: true,
    allowSessionOwner: true,
    authenticationKind: 'endpoint-credential'
  })
})
