import type { ManagedSkillInstall } from '../../../../shared/skill-install-contract'
import type { DiscoveredSkill } from '../../../../shared/skills'

export function matchingManagedSkillInstall(
  skill: DiscoveredSkill,
  installs: ManagedSkillInstall[]
): ManagedSkillInstall | null {
  const scope =
    skill.sourceKind === 'home' ? 'global' : skill.sourceKind === 'repo' ? 'workspace' : null
  if (!scope) {
    return null
  }
  const matches = installs.filter(
    (install) =>
      install.name === skill.name && install.scope === scope && install.state !== 'missing'
  )
  return matches.length === 1 ? matches[0] : null
}
