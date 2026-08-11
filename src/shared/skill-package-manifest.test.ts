import { describe, expect, it } from 'vitest'
import {
  computeSkillPackageDigest,
  parseSkillPackageManifest,
  validateSkillPackagePath,
  type SkillPackageFile
} from './skill-package-manifest'

const file: SkillPackageFile = {
  path: 'SKILL.md',
  size: 5,
  executable: false,
  classification: 'text',
  sha256: 'a'.repeat(64),
  identitySha256: 'b'.repeat(64)
}

function manifest(files: SkillPackageFile[] = [file]): unknown {
  return {
    schemaVersion: 1,
    packageId: 'package_1',
    versionId: 'version_1',
    name: 'test-skill',
    description: 'Test',
    createdAt: '2026-08-11T12:00:00.000Z',
    files,
    packageDigest: computeSkillPackageDigest(files)
  }
}

describe('skill package manifest', () => {
  it('parses a canonical manifest', () => {
    expect(parseSkillPackageManifest(manifest()).name).toBe('test-skill')
  })

  it.each([
    '../SKILL.md',
    '/SKILL.md',
    'C:/SKILL.md',
    'references\\escape.md',
    'references//x.md',
    'references/con',
    'references/trailing. '
  ])('rejects the non-portable path %s', (path) => {
    expect(() => validateSkillPackagePath(path)).toThrow('skill-package-path-invalid')
  })

  it('rejects case collisions and digest drift', () => {
    const collision = [file, { ...file, path: 'skill.md' }]
    expect(() => parseSkillPackageManifest(manifest(collision))).toThrow(
      'skill-package-case-collision'
    )
    expect(() =>
      parseSkillPackageManifest({ ...(manifest() as object), packageDigest: 'c'.repeat(64) })
    ).toThrow('skill-package-digest-mismatch')
  })
})
