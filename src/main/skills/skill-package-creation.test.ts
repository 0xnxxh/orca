import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createSkillPackageArchive } from './skill-package-creation'
import { extractSkillPackageArchive } from './skill-package-extraction'

const temporaryDirectories: string[] = []

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'orca-skill-package-test-'))
  temporaryDirectories.push(directory)
  return directory
}

async function createSkill(root: string): Promise<string> {
  const skill = join(root, 'test-skill')
  await mkdir(join(skill, 'scripts'), { recursive: true })
  await writeFile(
    join(skill, 'SKILL.md'),
    '---\nname: test-skill\ndescription: A private test skill\n---\n\n# Test\n'
  )
  await writeFile(join(skill, 'scripts', 'run.sh'), '#!/bin/sh\necho test\n')
  await chmod(join(skill, 'scripts', 'run.sh'), 0o755)
  return skill
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  )
})

describe('skill package creation and extraction', () => {
  it('round trips a validated skill and preserves executable identity', async () => {
    const root = await temporaryDirectory()
    const sourceDirectory = await createSkill(root)
    const archivePath = join(root, 'package.tar.gz')
    const created = await createSkillPackageArchive({
      sourceDirectory,
      archivePath,
      packageId: 'package_1',
      versionId: 'version_1',
      createdAt: '2026-08-11T12:00:00.000Z'
    })

    const extracted = await extractSkillPackageArchive({
      archivePath,
      destinationDirectory: join(root, 'extracted'),
      expectedArchiveSha256: created.archiveSha256,
      expectedPackageDigest: created.manifest.packageDigest
    })

    expect(extracted.manifest).toEqual(created.manifest)
    expect(extracted.manifest.files.map((file) => [file.path, file.executable])).toEqual([
      ['SKILL.md', false],
      ['scripts/run.sh', true]
    ])
    expect(await readFile(join(extracted.skillDirectory, 'scripts', 'run.sh'), 'utf8')).toContain(
      'echo test'
    )
  })

  it('creates deterministic archives for fixed publication metadata', async () => {
    const root = await temporaryDirectory()
    const sourceDirectory = await createSkill(root)
    const input = {
      sourceDirectory,
      packageId: 'package_1',
      versionId: 'version_1',
      createdAt: '2026-08-11T12:00:00.000Z'
    }
    const first = await createSkillPackageArchive({
      ...input,
      archivePath: join(root, 'one.tar.gz')
    })
    const second = await createSkillPackageArchive({
      ...input,
      archivePath: join(root, 'two.tar.gz')
    })

    expect(first.archiveSha256).toBe(second.archiveSha256)
    expect(await readFile(first.archivePath)).toEqual(await readFile(second.archivePath))
  })

  it('rejects archive and package identity mismatches before publishing extraction', async () => {
    const root = await temporaryDirectory()
    const sourceDirectory = await createSkill(root)
    const created = await createSkillPackageArchive({
      sourceDirectory,
      archivePath: join(root, 'package.tar.gz'),
      packageId: 'package_1',
      versionId: 'version_1'
    })

    await expect(
      extractSkillPackageArchive({
        archivePath: created.archivePath,
        destinationDirectory: join(root, 'wrong-package'),
        expectedPackageDigest: 'f'.repeat(64)
      })
    ).rejects.toThrow('skill-package-identity-mismatch')
    await expect(
      extractSkillPackageArchive({
        archivePath: created.archivePath,
        destinationDirectory: join(root, 'wrong-archive'),
        expectedArchiveSha256: 'f'.repeat(64)
      })
    ).rejects.toThrow('skill-package-archive-digest-mismatch')
  })
})
