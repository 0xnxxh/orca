import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createMacUpdateInstallFence,
  getMacUpdateFencePaths,
  readMacUpdateInstallFence,
  removeMacUpdateInstallFence,
  updateMacUpdateInstallFence
} from './mac-update-install-fence-storage'
import {
  consumeMacUpdateFenceDiagnostics,
  writeMacUpdateFenceDiagnostic
} from './mac-update-install-fence-diagnostics'
import type { MacUpdateInstallFence } from '../shared/mac-update-install-fence'

const temporaryHomes: string[] = []

function createFence(attemptId: string): MacUpdateInstallFence {
  const now = Date.now()
  return {
    schemaVersion: 1,
    attemptId,
    bundleIdentifier: 'com.stablyai.orca',
    sourceVersion: '1.0.0',
    targetVersion: '1.0.1',
    targetBundlePath: '/Applications/Orca.app',
    shipItStatePath: '/tmp/com.stablyai.orca.ShipIt/ShipItState.plist',
    sourcePid: 10,
    monitorPid: 11,
    phase: 'armed',
    createdAt: now,
    heartbeatAt: now,
    lastTransitionAt: now,
    absoluteExpiresAt: now + 30 * 60_000
  }
}

function createPaths() {
  const home = mkdtempSync(join(tmpdir(), 'orca-fence-storage-'))
  temporaryHomes.push(home)
  return getMacUpdateFencePaths(home)
}

afterEach(() => {
  for (const home of temporaryHomes.splice(0)) {
    rmSync(home, { recursive: true, force: true })
  }
})

describe('mac update install fence storage', () => {
  it('creates a user-only fence and reads it back', () => {
    const paths = createPaths()
    const fence = createFence('48f675fc-3017-4d19-9e41-fd4715a17f43')
    createMacUpdateInstallFence(fence, paths)

    expect(readMacUpdateInstallFence(Date.now(), paths)).toMatchObject({
      kind: 'valid',
      fence: { attemptId: fence.attemptId }
    })
    expect(readFileSync(paths.fencePath, 'utf8')).toContain(fence.attemptId)
  })

  it('does not overwrite an existing attempt', () => {
    const paths = createPaths()
    createMacUpdateInstallFence(createFence('6ddc1ad2-bb72-423d-8257-ae5d204a9bbc'), paths)
    expect(() =>
      createMacUpdateInstallFence(createFence('df23626f-2457-4622-a404-e5d7cac39eb6'), paths)
    ).toThrow('already exists')
  })

  it('rejects an oversized fence before parsing it', () => {
    const paths = createPaths()
    createMacUpdateInstallFence(createFence('8d6924d6-2004-479f-9925-e2068a6163f7'), paths)
    writeFileSync(paths.fencePath, 'x'.repeat(40 * 1024), 'utf8')

    expect(readMacUpdateInstallFence(Date.now(), paths)).toEqual({
      kind: 'invalid',
      reason: 'malformed'
    })
  })

  it('prevents attempt A from updating or removing attempt B', () => {
    const paths = createPaths()
    const attemptB = 'e68a146a-6476-4255-9a02-e184361ba084'
    createMacUpdateInstallFence(createFence(attemptB), paths)

    expect(
      updateMacUpdateInstallFence('de768a29-91ac-40d8-8f99-7b314d4ac2b8', (fence) => fence, paths)
    ).toBe(false)
    expect(removeMacUpdateInstallFence('de768a29-91ac-40d8-8f99-7b314d4ac2b8', paths)).toBe(false)
    expect(readMacUpdateInstallFence(Date.now(), paths)).toMatchObject({
      kind: 'valid',
      fence: { attemptId: attemptB }
    })
  })

  it('bounds, consumes, and removes early diagnostic records', () => {
    const paths = createPaths()
    writeMacUpdateFenceDiagnostic(
      'mac_update_fence_recovered',
      { reason: 'x'.repeat(512), attemptId: '48f675fc-3017-4d19-9e41-fd4715a17f43' },
      paths
    )

    expect(consumeMacUpdateFenceDiagnostics(paths)).toEqual([
      expect.objectContaining({
        event: 'mac_update_fence_recovered',
        reason: 'x'.repeat(128),
        attemptId: '48f675fc-3017-4d19-9e41-fd4715a17f43'
      })
    ])
    expect(existsSync(paths.diagnosticPath)).toBe(false)
    expect(consumeMacUpdateFenceDiagnostics(paths)).toEqual([])
  })
})
