import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { scanKnownPluginSkillCandidates } from './skill-plugin-cache-scan'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((root) => rm(root, { recursive: true })))
})

async function scanRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  temporaryDirectories.push(root)
  return root
}

describe('plugin skill candidate scan', () => {
  it('stops at the package candidate budget and cannot vouch for the rest', async () => {
    const root = await scanRoot('orca-plugin-skill-scan-')
    await Promise.all(
      ['one', 'two'].map((vendor) => mkdir(join(root, vendor, 'orca-cli'), { recursive: true }))
    )

    const result = await scanKnownPluginSkillCandidates(root, new Set(['orca-cli']), 1)

    expect(result.candidates).toHaveLength(1)
    expect(result.unverifiedPaths).toEqual([root])
  })

  it('treats a depth cutoff as pruned ground rather than a name it cannot vouch for', async () => {
    const root = await scanRoot('orca-plugin-skill-depth-')
    const segments = Array.from({ length: 11 }, (_, index) => `level-${index}`)
    const hiddenSkill = join(root, ...segments, 'orca-cli')
    await mkdir(hiddenSkill, { recursive: true })

    const result = await scanKnownPluginSkillCandidates(root, new Set(['orca-cli']))

    expect(result.candidates).toEqual([])
    // Why: no official skill sits this deep, so absence here is a real answer.
    expect(result.unverifiedPaths).toEqual([])
    expect(result.prunedPaths).toHaveLength(1)
    expect(hiddenSkill.startsWith(result.prunedPaths[0] ?? '')).toBe(true)
  })

  it('prunes vendored dependency trees instead of spending depth on them', async () => {
    const root = await scanRoot('orca-plugin-skill-vendored-')
    // The real shape: <namespace>/<plugin>/<version>/ then a vendored npm tree.
    const vendored = join(
      root,
      'openai-bundled/browser/26.721.41059/scripts/node_modules/classic-level/deps/leveldb/leveldb-1.20/db'
    )
    await mkdir(vendored, { recursive: true })
    const realSkill = join(root, 'openai-bundled/sites/0.1.31/skills/orca-cli')
    await mkdir(realSkill, { recursive: true })

    const result = await scanKnownPluginSkillCandidates(root, new Set(['orca-cli']))

    expect(result.candidates).toEqual([{ name: 'orca-cli', path: realSkill }])
    expect(result.unverifiedPaths).toEqual([])
    expect(result.prunedPaths).toEqual([
      join(root, 'openai-bundled/browser/26.721.41059/scripts/node_modules')
    ])
  })

  it('cannot vouch for a cache root it fails to read', async () => {
    const root = await scanRoot('orca-plugin-skill-unreadable-')
    const cachePath = join(root, 'cache')
    // Why: opening a file as a directory fails on every platform, unlike chmod,
    // which Windows ignores.
    await writeFile(cachePath, 'not a directory')

    const result = await scanKnownPluginSkillCandidates(cachePath, new Set(['orca-cli']))

    expect(result.candidates).toEqual([])
    expect(result.unverifiedPaths).toEqual([cachePath])
    expect(result.prunedPaths).toEqual([])
  })

  it('reports a missing cache as absence rather than something it cannot vouch for', async () => {
    const root = await scanRoot('orca-plugin-skill-missing-')

    const result = await scanKnownPluginSkillCandidates(join(root, 'cache'), new Set(['orca-cli']))

    expect(result.unverifiedPaths).toEqual([])
    expect(result.prunedPaths).toEqual([])
  })
})
