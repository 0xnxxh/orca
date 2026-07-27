import { CheckCircle2, Circle, XCircle } from 'lucide-react'
import { translate } from '@/i18n/i18n'

export type SkillRunRowStatus = 'pending' | 'done' | 'failed'

function statusIcon(status: SkillRunRowStatus): React.JSX.Element {
  if (status === 'done') {
    return <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
  }
  if (status === 'failed') {
    return <XCircle className="size-4 shrink-0 text-destructive" />
  }
  return <Circle className="size-4 shrink-0 text-muted-foreground" />
}

/**
 * Per-skill outcome rows for a finished or in-flight run.
 *
 * Rendered from the run itself rather than the freshness groups: a successful
 * update makes every skill current, which drops it out of `groupSkillFreshness`
 * entirely, so the groups are empty exactly when the results matter most.
 */
export function SkillUpdateResultRows({
  names,
  failedNames,
  pending
}: {
  names: readonly string[]
  failedNames?: readonly string[]
  pending?: boolean
}): React.JSX.Element {
  const failed = new Set(failedNames ?? [])
  return (
    <div className="flex flex-col">
      {names.map((name) => {
        const status: SkillRunRowStatus = pending ? 'pending' : failed.has(name) ? 'failed' : 'done'
        return (
          <div
            key={name}
            data-skill-result={name}
            data-status={status}
            className={`flex min-w-0 items-center gap-3 border-t border-border/60 py-2.5 first:border-t-0 first:pt-0.5 ${
              pending ? 'opacity-55' : ''
            }`}
          >
            {statusIcon(status)}
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium text-foreground">{name}</div>
              {status === 'failed' ? (
                <div className="text-xs leading-5 text-muted-foreground">
                  {translate(
                    'auto.components.skills.SkillUpdateResultRows.stillOutdated',
                    'Still out of date after the update ran.'
                  )}
                </div>
              ) : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}
