import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AGENT_PLUGIN_SCHEMA_V1 } from '../../shared/skill-bundle-manifest'
import { createSkillBundleArchive } from './skill-bundle-creation'
import { extractSkillBundleArchive } from './skill-bundle-extraction'

const temporaryDirectories: string[] = []

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'orca-skill-bundle-test-'))
  temporaryDirectories.push(directory)
  return directory
}

async function createSkill(root: string, name: string, description: string): Promise<string> {
  const directory = join(root, name)
  await mkdir(directory, { recursive: true })
  await writeFile(
    join(directory, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`
  )
  await writeFile(join(directory, 'notes.txt'), `${name} notes\n`)
  return directory
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  )
})

describe('skill bundle creation and extraction', () => {
  it('round trips multiple skills through an Agent Plugins compatible root', async () => {
    const root = await temporaryDirectory()
    const alpha = await createSkill(root, 'alpha-skill', 'Alpha')
    const beta = await createSkill(root, 'beta-skill', 'Beta')
    const created = await createSkillBundleArchive({
      sources: [{ sourceDirectory: beta }, { sourceDirectory: alpha }],
      archivePath: join(root, 'bundle.tar.gz'),
      packageId: 'package_1',
      versionId: 'version_1',
      bundleName: 'team-skills',
      description: 'Team skills',
      createdAt: '2026-08-11T12:00:00.000Z'
    })

    const extracted = await extractSkillBundleArchive({
      archivePath: created.archivePath,
      destinationDirectory: join(root, 'extracted'),
      expectedBundleDigest: created.manifest.bundleDigest
    })

    expect(extracted.pluginManifest).toEqual({
      $schema: AGENT_PLUGIN_SCHEMA_V1,
      name: 'team-skills',
      version: 'version_1',
      description: 'Team skills'
    })
    expect(extracted.manifest.skills.map((skill) => skill.name)).toEqual([
      'alpha-skill',
      'beta-skill'
    ])
    expect(await readFile(join(extracted.skillsDirectory, 'beta-skill', 'notes.txt'), 'utf8')).toBe(
      'beta-skill notes\n'
    )
  })

  it('creates deterministic archives regardless of source selection order', async () => {
    const root = await temporaryDirectory()
    const alpha = await createSkill(root, 'alpha-skill', 'Alpha')
    const beta = await createSkill(root, 'beta-skill', 'Beta')
    const publication = {
      packageId: 'package_1',
      versionId: 'version_1',
      bundleName: 'team-skills',
      createdAt: '2026-08-11T12:00:00.000Z'
    }
    const first = await createSkillBundleArchive({
      ...publication,
      sources: [{ sourceDirectory: alpha }, { sourceDirectory: beta }],
      archivePath: join(root, 'first.tar.gz')
    })
    const second = await createSkillBundleArchive({
      ...publication,
      sources: [{ sourceDirectory: beta }, { sourceDirectory: alpha }],
      archivePath: join(root, 'second.tar.gz')
    })

    expect(first.archiveSha256).toBe(second.archiveSha256)
    expect(await readFile(first.archivePath)).toEqual(await readFile(second.archivePath))
  })

  it('rejects duplicate names and source drift without publishing an archive', async () => {
    const root = await temporaryDirectory()
    const first = await createSkill(root, 'same-skill', 'First')
    const secondRoot = join(root, 'other')
    const second = await createSkill(secondRoot, 'same-skill', 'Second')
    const archivePath = join(root, 'duplicate.tar.gz')

    await expect(
      createSkillBundleArchive({
        sources: [{ sourceDirectory: first }, { sourceDirectory: second }],
        archivePath,
        packageId: 'package_1',
        versionId: 'version_1',
        bundleName: 'team-skills'
      })
    ).rejects.toThrow('skill-bundle-skill-collision')
    await expect(readFile(archivePath)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
