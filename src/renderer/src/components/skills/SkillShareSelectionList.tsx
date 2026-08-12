import type { DiscoveredSkill } from '../../../../shared/skills'
import { SkillShareSelectableCard } from './SkillShareSelectableCard'
import { selectedShareSkillNameKeys } from './SkillShareSelectionControls'

export function SkillShareSelectionList({
  skills,
  allSkills,
  local,
  selectedIds,
  selectionMode,
  onSelectedChange,
  onShare
}: {
  skills: readonly DiscoveredSkill[]
  allSkills: readonly DiscoveredSkill[]
  local: boolean
  selectedIds: ReadonlySet<string>
  selectionMode: boolean
  onSelectedChange: (skillId: string, selected: boolean) => void
  onShare: (skill: DiscoveredSkill) => void
}): React.JSX.Element {
  const selectedNames = selectedShareSkillNameKeys(allSkills, selectedIds)
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-3">
      {skills.map((skill) => (
        <SkillShareSelectableCard
          key={skill.id}
          skill={skill}
          local={local}
          duplicateNameSelected={
            !selectedIds.has(skill.id) && selectedNames.has(skill.name.toLocaleLowerCase('en-US'))
          }
          selected={selectedIds.has(skill.id)}
          selectionMode={selectionMode}
          onSelectedChange={(selected) => onSelectedChange(skill.id, selected)}
          onShare={() => onShare(skill)}
        />
      ))}
    </div>
  )
}
