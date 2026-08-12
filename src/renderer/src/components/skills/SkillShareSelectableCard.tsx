import type { DiscoveredSkill } from '../../../../shared/skills'
import { SkillCard } from './SkillCard'
import { isSkillShareEligible, skillShareEligibilityReason } from './SkillShareSelectionControls'

export function SkillShareSelectableCard({
  skill,
  local,
  duplicateNameSelected,
  selected,
  selectionMode,
  onSelectedChange,
  onShare
}: {
  skill: DiscoveredSkill
  local: boolean
  duplicateNameSelected: boolean
  selected: boolean
  selectionMode: boolean
  onSelectedChange: (selected: boolean) => void
  onShare: () => void
}): React.JSX.Element {
  const eligible = isSkillShareEligible(skill, local)
  const disabledReason = skillShareEligibilityReason(skill, local, duplicateNameSelected)
  return (
    <SkillCard
      skill={skill}
      selected={selected}
      selectionMode={selectionMode}
      selectionDisabled={disabledReason !== null}
      selectionDisabledReason={disabledReason}
      onSelectionChange={onSelectedChange}
      onShare={eligible ? onShare : undefined}
    />
  )
}
