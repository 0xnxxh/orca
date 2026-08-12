import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import type * as NodeFsPromises from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof NodeFsPromises>()),
  symlink: vi.fn(async () => {
    throw new Error('injected-alias-denial')
  })
}))

import { nativeSkillInstallFilesystem } from './skill-install-filesystem'
import { reconcileSkillProviderPlacement } from './skill-placement-reconciliation'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  )
})

describe('skill provider placement reconciliation', () => {
  it.each(['file', 'directory'] as const)(
    'preserves an unowned provider %s destination',
    async (kind) => {
      const root = await mkdtemp(join(tmpdir(), 'orca-skill-placement-test-'))
      temporaryDirectories.push(root)
      const canonicalPath = join(root, 'canonical', 'private-skill')
      const providerRoot = join(root, 'provider')
      const destinationPath = join(providerRoot, 'private-skill')
      await mkdir(canonicalPath, { recursive: true })
      await writeFile(join(canonicalPath, 'SKILL.md'), 'private skill')
      await mkdir(providerRoot)
      if (kind === 'file') {
        await writeFile(destinationPath, 'unowned file')
      } else {
        await mkdir(destinationPath)
        await writeFile(join(destinationPath, 'SKILL.md'), 'unowned directory')
      }
      const observed = await nativeSkillInstallFilesystem.observeSkill(canonicalPath)

      const result = await reconcileSkillProviderPlacement({
        canonicalPath,
        skillName: 'private-skill',
        destination: { provider: 'claude', rootPath: providerRoot, readsCanonicalRoot: false },
        previousReceipt: null,
        packageDigest: observed.observedDigest
      })

      expect(result).toMatchObject({
        topology: 'independent-copy',
        status: 'skipped',
        errorCategory: 'skill-placement-unowned'
      })
      const destinationStat = await lstat(destinationPath)
      expect(kind === 'file' ? destinationStat.isFile() : destinationStat.isDirectory()).toBe(true)
      if (kind === 'file') {
        expect(await readFile(destinationPath, 'utf8')).toBe('unowned file')
      } else {
        expect(await readFile(join(destinationPath, 'SKILL.md'), 'utf8')).toBe('unowned directory')
      }
    }
  )

  it('creates a verified independent copy when native alias creation is denied', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-skill-placement-test-'))
    temporaryDirectories.push(root)
    const canonicalPath = join(root, 'canonical', 'private-skill')
    const providerRoot = join(root, 'provider')
    await mkdir(canonicalPath, { recursive: true })
    await writeFile(join(canonicalPath, 'SKILL.md'), 'private skill')
    const observed = await nativeSkillInstallFilesystem.observeSkill(canonicalPath)

    const result = await reconcileSkillProviderPlacement({
      canonicalPath,
      skillName: 'private-skill',
      destination: { provider: 'claude', rootPath: providerRoot, readsCanonicalRoot: false },
      previousReceipt: null,
      packageDigest: observed.observedDigest
    })

    expect(result).toMatchObject({ topology: 'independent-copy', status: 'installed' })
    expect(await readFile(join(providerRoot, 'private-skill', 'SKILL.md'), 'utf8')).toBe(
      'private skill'
    )
  })

  it('creates a verified copy when a host-owned alias operation is denied', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-skill-placement-test-'))
    temporaryDirectories.push(root)
    const canonicalPath = join(root, 'canonical', 'private-skill')
    const providerRoot = join(root, 'provider')
    await mkdir(canonicalPath, { recursive: true })
    await writeFile(join(canonicalPath, 'SKILL.md'), 'private skill')
    const observed = await nativeSkillInstallFilesystem.observeSkill(canonicalPath)

    const result = await reconcileSkillProviderPlacement({
      canonicalPath,
      skillName: 'private-skill',
      destination: { provider: 'claude', rootPath: providerRoot, readsCanonicalRoot: false },
      previousReceipt: null,
      packageDigest: observed.observedDigest,
      filesystem: {
        ...nativeSkillInstallFilesystem,
        createAlias: async () => {
          throw new Error('injected-host-alias-denial')
        }
      }
    })

    expect(result).toMatchObject({ topology: 'independent-copy', status: 'installed' })
    expect(await readFile(join(providerRoot, 'private-skill', 'SKILL.md'), 'utf8')).toBe(
      'private skill'
    )
  })

  it('uses host alias inspection when the client cannot stat the destination', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-skill-placement-test-'))
    temporaryDirectories.push(root)
    const canonicalPath = join(root, 'canonical', 'private-skill')
    const providerRoot = join(root, 'provider')
    await mkdir(canonicalPath, { recursive: true })
    await writeFile(join(canonicalPath, 'SKILL.md'), 'private skill')
    const observed = await nativeSkillInstallFilesystem.observeSkill(canonicalPath)
    const createAlias = vi.fn()

    const result = await reconcileSkillProviderPlacement({
      canonicalPath,
      skillName: 'private-skill',
      destination: { provider: 'claude', rootPath: providerRoot, readsCanonicalRoot: false },
      previousReceipt: null,
      packageDigest: observed.observedDigest,
      filesystem: {
        ...nativeSkillInstallFilesystem,
        createAlias,
        aliasTargets: async () => true
      }
    })

    expect(result).toMatchObject({ topology: 'provider-alias', status: 'unchanged' })
    expect(createAlias).not.toHaveBeenCalled()
  })
})
