import { Share2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { DiscoveredSkill } from '../../../../shared/skills'
import { translate } from '@/i18n/i18n'

export function isSkillShareEligible(skill: DiscoveredSkill, local: boolean): boolean {
  return local && skill.installed && (skill.sourceKind === 'home' || skill.sourceKind === 'repo')
}

export function skillShareEligibilityReason(
  skill: DiscoveredSkill,
  local: boolean,
  duplicateNameSelected = false
): string | null {
  if (!local) {
    return translate(
      'auto.components.skills.SkillShareSelectionControls.01c5a15e06',
      'Open this skill on its owning machine to share it.'
    )
  }
  if (!skill.installed) {
    return translate(
      'auto.components.skills.SkillShareSelectionControls.01c5a15e07',
      'Install this skill before sharing it.'
    )
  }
  if (skill.sourceKind !== 'home' && skill.sourceKind !== 'repo') {
    return translate(
      'auto.components.skills.SkillShareSelectionControls.01c5a15e08',
      'Only home and workspace skills can be shared.'
    )
  }
  return duplicateNameSelected
    ? translate(
        'auto.components.skills.SkillShareSelectionControls.01c5a15e09',
        'A skill with this name is already selected from another source.'
      )
    : null
}

function shareSkillNameKey(skill: DiscoveredSkill): string {
  return skill.name.toLocaleLowerCase('en-US')
}

export function selectedShareSkillNameKeys(
  skills: readonly DiscoveredSkill[],
  selectedIds: ReadonlySet<string>
): Set<string> {
  return new Set(
    skills.filter((skill) => selectedIds.has(skill.id)).map((skill) => shareSkillNameKey(skill))
  )
}

export function addShareableSkillResults(
  current: ReadonlySet<string>,
  skills: readonly DiscoveredSkill[],
  results: readonly DiscoveredSkill[],
  local: boolean
): Set<string> {
  const next = new Set(current)
  const selectedNames = selectedShareSkillNameKeys(skills, current)
  for (const skill of results) {
    const name = shareSkillNameKey(skill)
    if (!isSkillShareEligible(skill, local) || selectedNames.has(name)) {
      continue
    }
    next.add(skill.id)
    selectedNames.add(name)
  }
  return next
}

export function updatedSkillSelection(
  current: ReadonlySet<string>,
  skillId: string,
  selected: boolean
): Set<string> {
  const next = new Set(current)
  if (selected) {
    next.add(skillId)
  } else {
    next.delete(skillId)
  }
  return next
}

export function SkillShareSelectionAction({
  selecting,
  selectedCount,
  onClick
}: {
  selecting: boolean
  selectedCount: number
  onClick: () => void
}): React.JSX.Element {
  const label = selecting
    ? selectedCount > 0
      ? translate(
          'auto.components.skills.SkillShareSelectionControls.01c5a15e05',
          'Share {{value0}} skills',
          { value0: selectedCount }
        )
      : translate('auto.components.skills.SkillShareSelectionControls.01c5a15e01', 'Cancel sharing')
    : translate('auto.components.skills.SkillShareSelectionControls.01c5a15e02', 'Share skills')
  return (
    <Button type="button" variant={selecting ? 'secondary' : 'outline'} size="sm" onClick={onClick}>
      <Share2 className="size-3.5" />
      {label}
    </Button>
  )
}

export function SkillShareSelectionStatus({
  selectedCount,
  onSelectAll
}: {
  selectedCount: number
  onSelectAll: () => void
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
      <span>
        {translate(
          'auto.components.skills.SkillShareSelectionControls.01c5a15e03',
          '{{value0}} selected',
          { value0: selectedCount }
        )}
      </span>
      <Button type="button" variant="ghost" size="xs" onClick={onSelectAll}>
        {translate(
          'auto.components.skills.SkillShareSelectionControls.01c5a15e04',
          'Select all results'
        )}
      </Button>
    </div>
  )
}
