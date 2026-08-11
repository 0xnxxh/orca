import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  previewSharedSkillInstall,
  removeSharedSkillInstall
} from './skill-install-management-service'

describe('skill install management', () => {
  let root = ''
  let homeDirectory = ''
  let stateDirectory = ''

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'orca-skill-management-test-'))
    homeDirectory = join(root, 'home')
    stateDirectory = join(root, 'state')
    await Promise.all([mkdir(homeDirectory), mkdir(stateDirectory)])
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  function dependencies() {
    return {
      authority: {
        environmentId: 'runtime-1',
        homeDirectory,
        resolveWorktree: async () => null,
        resolveFolderWorkspace: async () => null
      },
      stateDirectory,
      detectProviders: async () => ['codex', 'claude']
    }
  }

  it('previews a missing global install without mutating the destination', async () => {
    const preview = await previewSharedSkillInstall(
      {
        name: 'example',
        package: {
          packageId: 'package-1',
          versionId: 'version-1',
          packageDigest: 'a'.repeat(64),
          archiveSha256: 'b'.repeat(64),
          compressedBytes: 100
        },
        destination: { scope: 'global' }
      },
      dependencies()
    )

    expect(preview).toMatchObject({
      name: 'example',
      currentState: 'missing',
      destinationIdentity: 'global:runtime-1'
    })
    expect(preview.providers.map((provider) => provider.provider)).toEqual(['codex', 'claude'])
  })

  it('refuses to remove an unowned destination', async () => {
    const canonicalPath = join(homeDirectory, '.agents', 'skills', 'example')
    await mkdir(canonicalPath, { recursive: true })

    const result = await removeSharedSkillInstall(
      {
        operationId: 'operation-1',
        name: 'example',
        destination: { scope: 'global' }
      },
      dependencies()
    )

    expect(result).toMatchObject({ status: 'conflict', conflict: { kind: 'unowned' } })
  })
})
