import type { SkillFreshnessInventory } from '../../../shared/skill-freshness'

export type SkillFreshnessDisplayStatus =
  | 'installed'
  | 'up-to-date'
  | 'update-available'
  | 'needs-attention'

export function getSkillFreshnessDisplayStatus(
  inventory: SkillFreshnessInventory | null,
  skillName: string
): SkillFreshnessDisplayStatus {
  if (inventory?.eligibleUpdateNames.includes(skillName)) {
    return 'update-available'
  }

  let hasPlacement = false
  let hasBlockedCopy = false
  for (const installation of inventory?.installations ?? []) {
    if (installation.name !== skillName) {
      continue
    }
    hasPlacement = true
    if (installation.status !== 'current') {
      hasBlockedCopy = true
    }
  }
  // Why: with no scan yet (or nothing found) the only honest answer is presence.
  // Reporting attention here would flash amber on every launch before the first scan.
  if (!hasPlacement) {
    return 'installed'
  }
  // Why: no eligible update is not proof a copy is fine — it can equally mean a copy
  // is out of date somewhere the update command cannot reach. Saying "Installed" there
  // reads as all-clear and hides real drift, so that case gets its own attention state.
  return hasBlockedCopy ? 'needs-attention' : 'up-to-date'
}
