import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createSkillPackageArchive } from './skill-package-creation'
import {
  installLocalSkillPackage,
  previewLocalSkillPackage,
  type LocalSkillInstallInput
} from './skill-install-transaction'
import { nativeSkillInstallFilesystem } from './skill-install-filesystem'

const temporaryDirectories: string[] = []

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'orca-skill-install-test-'))
  temporaryDirectories.push(directory)
  return directory
}

async function packageVersion(root: string, version: string, body: string) {
  const source = join(root, `source-${version}`)
  await mkdir(source, { recursive: true })
  await writeFile(
    join(source, 'SKILL.md'),
    `---\nname: test-skill\ndescription: Test skill\n---\n\n${body}\n`
  )
  return createSkillPackageArchive({
    sourceDirectory: source,
    archivePath: join(root, `${version}.tar.gz`),
    packageId: 'package_1',
    versionId: version,
    createdAt: '2026-08-11T12:00:00.000Z'
  })
}

function installInput(
  root: string,
  archive: Awaited<ReturnType<typeof packageVersion>>,
  overrides: Partial<LocalSkillInstallInput> = {}
): LocalSkillInstallInput {
  return {
    operationId: `operation-${archive.manifest.versionId}`,
    archivePath: archive.archivePath,
    destinationRoot: join(root, 'skills'),
    stateDirectory: join(root, 'state'),
    scope: 'global',
    destinationIdentity: 'global:test-host',
    hostIdentity: 'test-host',
    expectedArchiveSha256: archive.archiveSha256,
    expectedPackageDigest: archive.manifest.packageDigest,
    expectedPackageId: archive.manifest.packageId,
    expectedVersionId: archive.manifest.versionId,
    ...overrides
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  )
})

describe('skill install transaction', () => {
  it('installs, previews unchanged bytes, and updates a clean receipt-owned skill', async () => {
    const root = await temporaryDirectory()
    const first = await packageVersion(root, 'version_1', '# First')
    const second = await packageVersion(root, 'version_2', '# Second')

    const installed = await installLocalSkillPackage(installInput(root, first))
    expect(installed.status).toBe('installed')
    expect(await readFile(join(root, 'skills', 'test-skill', 'SKILL.md'), 'utf8')).toContain(
      '# First'
    )

    const preview = await previewLocalSkillPackage(installInput(root, first))
    expect(preview.currentState.kind).toBe('unchanged')
    expect((await installLocalSkillPackage(installInput(root, first))).status).toBe('unchanged')

    const updated = await installLocalSkillPackage(installInput(root, second))
    expect(updated.status).toBe('updated')
    expect(await readFile(join(root, 'skills', 'test-skill', 'SKILL.md'), 'utf8')).toContain(
      '# Second'
    )
  })

  it('refuses to overwrite a modified receipt-owned installation', async () => {
    const root = await temporaryDirectory()
    const first = await packageVersion(root, 'version_1', '# First')
    const second = await packageVersion(root, 'version_2', '# Second')
    await installLocalSkillPackage(installInput(root, first))
    await writeFile(join(root, 'skills', 'test-skill', 'local.md'), 'local change')

    const result = await installLocalSkillPackage(installInput(root, second))

    expect(result.status).toBe('conflict')
    expect(result.conflict?.kind).toBe('modified')
    expect(await readFile(join(root, 'skills', 'test-skill', 'local.md'), 'utf8')).toBe(
      'local change'
    )
  })

  it('requires explicit replacement for an unowned directory', async () => {
    const root = await temporaryDirectory()
    const archive = await packageVersion(root, 'version_1', '# Cloud')
    const destination = join(root, 'skills', 'test-skill')
    await mkdir(destination, { recursive: true })
    await writeFile(join(destination, 'SKILL.md'), 'unowned')

    const conflict = await installLocalSkillPackage(installInput(root, archive))
    expect(conflict.conflict?.kind).toBe('unowned')

    const replaced = await installLocalSkillPackage(
      installInput(root, archive, { conflictResolution: 'replace-and-discard-local' })
    )
    expect(replaced.status).toBe('installed')
    expect(await readFile(join(destination, 'SKILL.md'), 'utf8')).toContain('# Cloud')
  })

  it('restores the previous version when commit is interrupted after backup', async () => {
    const root = await temporaryDirectory()
    const first = await packageVersion(root, 'version_1', '# First')
    const second = await packageVersion(root, 'version_2', '# Second')
    await installLocalSkillPackage(installInput(root, first))
    let renameCount = 0
    const interruptedFilesystem = {
      ...nativeSkillInstallFilesystem,
      rename: async (source: string, target: string): Promise<void> => {
        renameCount += 1
        if (renameCount === 3) {
          throw new Error('injected-commit-interruption')
        }
        await nativeSkillInstallFilesystem.rename(source, target)
      }
    }

    await expect(
      installLocalSkillPackage(installInput(root, second, { filesystem: interruptedFilesystem }))
    ).rejects.toThrow('injected-commit-interruption')
    expect(await readFile(join(root, 'skills', 'test-skill', 'SKILL.md'), 'utf8')).toContain(
      '# First'
    )

    const retried = await installLocalSkillPackage(installInput(root, second))
    expect(retried.status).toBe('updated')
    expect(await readFile(join(root, 'skills', 'test-skill', 'SKILL.md'), 'utf8')).toContain(
      '# Second'
    )
  })
})
