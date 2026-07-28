import { describe, expect, it } from 'vitest'
import type { SkillFreshnessInstallation, SkillKnownSnapshot } from '../../shared/skill-freshness'
import { convergableSkillNames } from './skill-update-convergence'

function placement(name: string, observedPackageDigest: string | null): SkillFreshnessInstallation {
  return {
    id: `${name}:${observedPackageDigest}`,
    name,
    rootId: 'home',
    providers: [],
    sourceKind: 'home',
    sourceLabel: 'home',
    unresolvedPath: `~/.agents/skills/${name}`,
    resolvedPath: `/home/u/.agents/skills/${name}`,
    physicalIdentity: '1:1',
    topology: 'canonical-copy',
    status: 'outdated',
    installedReleaseRevision: null,
    installedAppVersion: null,
    currentReleaseRevision: 8,
    currentPackageDigest: 'digest-current',
    currentAppVersion: '1.4.160',
    observedPackageDigest,
    errorCategory: null
  }
}

function revision(packageDigest: string, gitTreeSha: string): SkillKnownSnapshot {
  return { releaseRevision: 1, packageDigest, gitTreeSha, files: [] }
}

describe('convergableSkillNames', () => {
  // The real reported case: the lock records the stub tree (091d9bcc) while disk
  // still holds the pre-stub revision (f3727995). `skills update` compares lock to
  // source, sees no work, exits 0 and writes nothing — forever.
  it('drops a skill whose lock records a revision the disk does not have', () => {
    const result = convergableSkillNames(
      [placement('orca-linear', 'digest-pre-stub')],
      new Map([['orca-linear', '091d9bcc']]),
      {
        'orca-linear': [
          revision('digest-pre-stub', 'f3727995'),
          revision('digest-stub', '091d9bcc')
        ]
      }
    )
    expect([...result]).toEqual([])
  })

  // The legitimate case that must NOT be gated: lock and disk agree, and the source
  // has simply moved ahead of what this build bundles. The update really can converge.
  it('keeps a skill whose lock matches disk even when it is outdated', () => {
    const result = convergableSkillNames(
      [placement('orca-cli', 'digest-installed')],
      new Map([['orca-cli', 'aaaa1111']]),
      { 'orca-cli': [revision('digest-installed', 'aaaa1111')] }
    )
    expect([...result]).toEqual(['orca-cli'])
  })

  it('keeps a skill whose disk content matches no known revision', () => {
    const result = convergableSkillNames(
      [placement('orca-cli', 'digest-unknown')],
      new Map([['orca-cli', 'aaaa1111']]),
      { 'orca-cli': [revision('digest-other', 'bbbb2222')] }
    )
    expect([...result]).toEqual(['orca-cli'])
  })

  it('keeps a skill with no observable placement', () => {
    const result = convergableSkillNames(
      [placement('orca-cli', null)],
      new Map([['orca-cli', 'aaaa1111']]),
      { 'orca-cli': [revision('digest-installed', 'aaaa1111')] }
    )
    expect([...result]).toEqual(['orca-cli'])
  })

  // One placement still matching the lock means the command has an anchor to write.
  it('keeps a skill when any placement still matches the lock', () => {
    const result = convergableSkillNames(
      [placement('orca-cli', 'digest-installed'), placement('orca-cli', 'digest-pre-stub')],
      new Map([['orca-cli', 'aaaa1111']]),
      {
        'orca-cli': [
          revision('digest-installed', 'aaaa1111'),
          revision('digest-pre-stub', 'f3727995')
        ]
      }
    )
    expect([...result]).toEqual(['orca-cli'])
  })

  // A lock hash we cannot place is not evidence the command is stuck.
  it('keeps a skill whose lock names no revision we know', () => {
    const result = convergableSkillNames(
      [placement('orca-cli', 'digest-pre-stub')],
      new Map([['orca-cli', 'not-a-known-tree']]),
      { 'orca-cli': [revision('digest-pre-stub', 'f3727995')] }
    )
    expect([...result]).toEqual(['orca-cli'])
  })

  it('judges each locked skill independently', () => {
    const result = convergableSkillNames(
      [placement('orca-linear', 'digest-pre-stub'), placement('orca-cli', 'digest-installed')],
      new Map([
        ['orca-linear', '091d9bcc'],
        ['orca-cli', 'aaaa1111']
      ]),
      {
        'orca-linear': [
          revision('digest-pre-stub', 'f3727995'),
          revision('digest-stub', '091d9bcc')
        ],
        'orca-cli': [revision('digest-installed', 'aaaa1111')]
      }
    )
    expect([...result]).toEqual(['orca-cli'])
  })
})
