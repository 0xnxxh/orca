import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { groupInstallState, type SkillManagedInstallGroup } from './skill-managed-install-groups'

export function SkillManagedInstallList({
  groups,
  selectedKey,
  onSelect
}: {
  groups: SkillManagedInstallGroup[]
  selectedKey: string
  onSelect: (group: SkillManagedInstallGroup) => void
}): React.JSX.Element {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {groups.map((group) => {
        const state = groupInstallState(group)
        const isBundle = Boolean(group.bundleDigest)
        return (
          <Button
            key={group.key}
            type="button"
            variant={selectedKey === group.key ? 'secondary' : 'outline'}
            className="h-auto justify-start p-3 text-left"
            onClick={() => onSelect(group)}
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">
                {isBundle
                  ? translate(
                      'auto.components.skills.SkillManagedInstallList.86c76cb262',
                      '{{count}} skill bundle',
                      { count: group.installs.length }
                    )
                  : group.installs[0]?.name}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {group.installs[0]?.scope} · {group.versionId}
              </span>
            </span>
            <Badge variant={state === 'unchanged' ? 'outline' : 'destructive'} className="ml-auto">
              {state}
            </Badge>
          </Button>
        )
      })}
    </div>
  )
}
