import type { DiscoveredSkill } from '../../../../shared/skills'
import { SkillCard } from './SkillCard'
import { isSkillShareEligible } from './SkillShareSelectionControls'

export function SkillShareSelectableCard({
  skill,
  local,
  selected,
  selectionMode,
  onSelectedChange,
  onShare
}: {
  skill: DiscoveredSkill
  local: boolean
  selected: boolean
  selectionMode: boolean
  onSelectedChange: (selected: boolean) => void
  onShare: () => void
}): React.JSX.Element {
  const eligible = isSkillShareEligible(skill, local)
  return (
    <SkillCard
      skill={skill}
      selected={selected}
      selectionMode={selectionMode}
      selectionDisabled={!eligible}
      onSelectionChange={onSelectedChange}
      onShare={eligible ? onShare : undefined}
    />
  )
}
