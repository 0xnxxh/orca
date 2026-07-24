import { describe, expect, it } from 'vitest'
import type {
  SkillFreshnessInstallation,
  SkillFreshnessInventory
} from '../../../../shared/skill-freshness'
import { skillFreshnessAttention } from './skill-freshness-skipped-reason'

function placement(
  overrides: Partial<SkillFreshnessInstallation> = {}
): SkillFreshnessInstallation {
  return {
    id: `orchestration-${overrides.unresolvedPath ?? 'main'}`,
    name: 'orchestration',
    rootId: 'home-agents',
    providers: ['agent-skills'],
    sourceKind: 'home',
    sourceLabel: 'Agent skills home',
    unresolvedPath: '/home/.agents/skills/orchestration',
    resolvedPath: '/home/.agents/skills/orchestration',
    physicalIdentity: 'physical-main',
    topology: 'canonical-copy',
    status: 'current',
    installedReleaseRevision: 2,
    installedAppVersion: '2.0.0',
    currentReleaseRevision: 2,
    currentPackageDigest: 'current',
    currentAppVersion: '2.0.0',
    observedPackageDigest: 'current',
    errorCategory: null,
    ...overrides
  }
}

function inventory(installations: SkillFreshnessInstallation[]): SkillFreshnessInventory {
  return { schemaVersion: 1, installations, eligibleUpdateNames: [], scannedAt: 1 }
}

describe('skillFreshnessAttention', () => {
  it('names the stale duplicate the global command cannot reach', () => {
    const attention = skillFreshnessAttention(
      inventory([
        placement(),
        placement({
          unresolvedPath: '/home/.cursor/skills/orchestration',
          resolvedPath: '/home/.cursor/skills/orchestration',
          physicalIdentity: 'physical-cursor',
          topology: 'independent-copy',
          status: 'outdated'
        })
      ]),
      'orchestration'
    )
    expect(attention?.reason).toContain('separate copy')
    expect(attention?.reason).toContain('only refreshes the main copy')
    // Why: the sentence says "this copy" — off the dialog there are no location rows,
    // so the offending path is the only thing that can give "this" a referent. The
    // healthy main copy must stay out of it or it reads as the one to remove.
    expect(attention?.paths).toEqual(['/home/.cursor/skills/orchestration'])
  })

  it('names every copy the reason covers, not just the first', () => {
    const attention = skillFreshnessAttention(
      inventory([
        placement(),
        placement({
          unresolvedPath: '/home/.cursor/skills/orchestration',
          physicalIdentity: 'physical-cursor',
          topology: 'independent-copy',
          status: 'outdated'
        }),
        placement({
          unresolvedPath: '/home/.grok/skills/orchestration',
          physicalIdentity: 'physical-grok',
          topology: 'independent-copy',
          status: 'outdated'
        })
      ]),
      'orchestration'
    )
    // Why: naming one of two duplicates would leave the badge unexplained after the
    // user resolves it, which is the loop this whole change exists to end.
    expect(attention?.paths).toEqual([
      '/home/.cursor/skills/orchestration',
      '/home/.grok/skills/orchestration'
    ])
  })

  it('leads with the harder blocker when several placements are off', () => {
    // Why: an edited copy is the real cause; the duplicate is the lesser symptom.
    const attention = skillFreshnessAttention(
      inventory([
        placement({
          unresolvedPath: '/home/.cursor/skills/orchestration',
          physicalIdentity: 'physical-cursor',
          topology: 'independent-copy',
          status: 'outdated'
        }),
        placement({
          unresolvedPath: '/home/.claude/skills/orchestration',
          physicalIdentity: 'physical-claude',
          topology: 'independent-copy',
          status: 'unrecognized'
        })
      ]),
      'orchestration'
    )
    expect(attention?.reason).toContain('doesn’t match the official version')
    // Why: the paths must match the sentence that won, or the card would point at a
    // copy the reason is not describing.
    expect(attention?.paths).toEqual(['/home/.claude/skills/orchestration'])
  })

  it('has nothing to say about a skill it never found', () => {
    expect(skillFreshnessAttention(inventory([]), 'orchestration')).toBeNull()
    expect(skillFreshnessAttention(null, 'orchestration')).toBeNull()
  })
})
