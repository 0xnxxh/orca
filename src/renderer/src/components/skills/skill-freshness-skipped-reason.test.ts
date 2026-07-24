import { describe, expect, it } from 'vitest'
import type {
  SkillFreshnessInstallation,
  SkillFreshnessInventory
} from '../../../../shared/skill-freshness'
import { skillFreshnessAttentionReason } from './skill-freshness-skipped-reason'

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

describe('skillFreshnessAttentionReason', () => {
  it('names the stale duplicate the global command cannot reach', () => {
    const reason = skillFreshnessAttentionReason(
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
    expect(reason).toContain('separate copy')
    expect(reason).toContain('only refreshes the main copy')
  })

  it('leads with the harder blocker when several placements are off', () => {
    // Why: an edited copy is the real cause; the duplicate is the lesser symptom.
    const reason = skillFreshnessAttentionReason(
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
    expect(reason).toContain('doesn’t match the official version')
  })

  it('has nothing to say about a skill it never found', () => {
    expect(skillFreshnessAttentionReason(inventory([]), 'orchestration')).toBeNull()
    expect(skillFreshnessAttentionReason(null, 'orchestration')).toBeNull()
  })
})
