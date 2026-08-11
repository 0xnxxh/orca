import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createSkillPackageArchive } from './skill-package-creation'
import {
  installSharedSkill,
  removeSharedSkill,
  type SkillInstallServiceInput
} from './skill-install-service'

const temporaryDirectories: string[] = []

async function fixture(): Promise<{
  root: string
  input: SkillInstallServiceInput
}> {
  const root = await mkdtemp(join(tmpdir(), 'orca-skill-service-test-'))
  temporaryDirectories.push(root)
  const source = join(root, 'source')
  await mkdir(source)
  await writeFile(
    join(source, 'SKILL.md'),
    '---\nname: test-skill\ndescription: Test\n---\n\n# Test\n'
  )
  const archive = await createSkillPackageArchive({
    sourceDirectory: source,
    archivePath: join(root, 'package.tar.gz'),
    packageId: 'package_1',
    versionId: 'version_1'
  })
  return {
    root,
    input: {
      operationId: 'operation_1',
      archivePath: archive.archivePath,
      scope: 'global',
      homeDirectory: join(root, 'home'),
      orcaStateDirectory: join(root, 'orca-state'),
      detectedProviders: ['codex', 'claude'],
      destinationIdentity: 'global:test-host',
      hostIdentity: 'test-host',
      expectedArchiveSha256: archive.archiveSha256,
      expectedPackageDigest: archive.manifest.packageDigest,
      expectedPackageId: archive.manifest.packageId,
      expectedVersionId: archive.manifest.versionId
    }
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  )
})

describe('skill install service', () => {
  it('installs one canonical copy and aliases Claude to it', async () => {
    const { root, input } = await fixture()
    const result = await installSharedSkill(input)
    const canonical = join(root, 'home', '.agents', 'skills', 'test-skill')
    const claude = join(root, 'home', '.claude', 'skills', 'test-skill')

    expect(result.status).toBe('installed')
    expect(result.placements).toHaveLength(2)
    expect(await realpath(claude)).toBe(await realpath(canonical))
  })

  it('leaves an unowned provider copy untouched and reports partial coverage', async () => {
    const { root, input } = await fixture()
    const claude = join(root, 'home', '.claude', 'skills', 'test-skill')
    await mkdir(claude, { recursive: true })
    await writeFile(join(claude, 'SKILL.md'), 'unowned')

    const result = await installSharedSkill(input)

    expect(result.status).toBe('partial')
    expect(result.placements.at(-1)).toMatchObject({
      provider: 'claude',
      status: 'skipped',
      errorCategory: 'skill-placement-unowned'
    })
    expect(await readFile(join(claude, 'SKILL.md'), 'utf8')).toBe('unowned')
  })

  it('removes the canonical skill and its owned provider alias', async () => {
    const { root, input } = await fixture()
    await installSharedSkill(input)

    const result = await removeSharedSkill({
      operationId: 'remove_1',
      skillName: 'test-skill',
      scope: 'global',
      homeDirectory: input.homeDirectory,
      orcaStateDirectory: input.orcaStateDirectory,
      detectedProviders: input.detectedProviders
    })

    expect(result.status).toBe('removed')
    await expect(
      lstat(join(root, 'home', '.agents', 'skills', 'test-skill'))
    ).rejects.toMatchObject({
      code: 'ENOENT'
    })
    await expect(
      lstat(join(root, 'home', '.claude', 'skills', 'test-skill'))
    ).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('preserves modified canonical and provider content during removal', async () => {
    const { root, input } = await fixture()
    await installSharedSkill(input)
    const canonical = join(root, 'home', '.agents', 'skills', 'test-skill')
    const claude = join(root, 'home', '.claude', 'skills', 'test-skill')
    await writeFile(join(canonical, 'local.md'), 'keep canonical')

    const conflict = await removeSharedSkill({
      operationId: 'remove_1',
      skillName: 'test-skill',
      scope: 'global',
      homeDirectory: input.homeDirectory,
      orcaStateDirectory: input.orcaStateDirectory,
      detectedProviders: input.detectedProviders
    })
    expect(conflict.conflict?.kind).toBe('modified')
    expect(await readFile(join(canonical, 'local.md'), 'utf8')).toBe('keep canonical')

    await rm(claude, { force: true })
    await mkdir(claude)
    await writeFile(join(claude, 'local.md'), 'keep provider')
    const removed = await removeSharedSkill({
      operationId: 'remove_2',
      skillName: 'test-skill',
      scope: 'global',
      homeDirectory: input.homeDirectory,
      orcaStateDirectory: input.orcaStateDirectory,
      detectedProviders: input.detectedProviders,
      conflictResolution: 'replace-and-discard-local'
    })
    expect(removed.status).toBe('partial')
    expect(await readFile(join(claude, 'local.md'), 'utf8')).toBe('keep provider')
  })
})
