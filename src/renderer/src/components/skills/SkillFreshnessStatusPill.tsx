import { useSkillFreshness } from '@/hooks/useSkillFreshness'
import { translate } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'
import { IntegrationStatusPill } from '@/components/integration-status-pill'
import {
  getSkillFreshnessDisplayStatus,
  type SkillFreshnessDisplayStatus
} from '@/lib/skill-freshness-display-status'
import { requestSkillFreshnessUpdateDialog } from './skill-freshness-update-dialog'

function statusPill(status: SkillFreshnessDisplayStatus): React.JSX.Element {
  if (status === 'update-available') {
    return (
      <IntegrationStatusPill tone="attention">
        {translate(
          'auto.components.skills.SkillFreshnessStatusPill.updateAvailable',
          'Update available'
        )}
      </IntegrationStatusPill>
    )
  }
  if (status === 'needs-attention') {
    return (
      <IntegrationStatusPill tone="attention">
        {translate(
          'auto.components.skills.SkillFreshnessStatusPill.needsAttention',
          'Needs attention'
        )}
      </IntegrationStatusPill>
    )
  }
  if (status === 'up-to-date') {
    return (
      <IntegrationStatusPill tone="connected">
        {translate('auto.components.skills.SkillFreshnessStatusPill.upToDate', 'Up to date')}
      </IntegrationStatusPill>
    )
  }
  return (
    <IntegrationStatusPill tone="connected">
      {translate('auto.components.skills.SkillFreshnessStatusPill.installed', 'Installed')}
    </IntegrationStatusPill>
  )
}

// Why: the setup rails' Installed pill is presence-only. Freshness knows more — that
// a safe update exists, that every copy is current, or that a copy is out of date
// somewhere the update cannot reach — and green must never stand in for that last
// case, which is real drift the user would otherwise have no way to see.
export function SkillFreshnessStatusPill({ skillName }: { skillName: string }): React.JSX.Element {
  const { inventory } = useSkillFreshness()
  const status = getSkillFreshnessDisplayStatus(inventory, skillName)
  // Why: the dialog lists every placement, so Details is offered whenever a placement
  // is what drove the status — an available update, or a copy that blocked one.
  const hasDetails = status === 'update-available' || status === 'needs-attention'
  return (
    <span className="inline-flex items-center gap-2">
      {statusPill(status)}
      {hasDetails ? (
        <Button
          variant="link"
          size="xs"
          className="h-auto p-0 text-[11px]"
          onClick={() => requestSkillFreshnessUpdateDialog()}
        >
          {translate('auto.components.skills.SkillFreshnessStatusPill.details', 'Details')}
        </Button>
      ) : null}
    </span>
  )
}
