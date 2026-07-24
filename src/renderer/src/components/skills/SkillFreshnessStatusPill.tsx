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

// Why: the setup rails' Installed pill is presence-only; when freshness knows a
// safe update exists (or that every copy is current) the pill should say so.
// Falls back to plain Installed for blocked/unrecognized copies so an unsafe
// placement is never advertised as updatable here.
export function SkillFreshnessStatusPill({ skillName }: { skillName: string }): React.JSX.Element {
  const { inventory } = useSkillFreshness()
  const status = getSkillFreshnessDisplayStatus(inventory, skillName)
  // Why: the review dialog only lists skills with an out-of-date copy, so Details
  // appears exactly when it has something to show — including the blocked copies
  // that hold the pill at plain Installed with no other explanation on this rail.
  const hasOutdatedCopy = (inventory?.installations ?? []).some(
    (installation) => installation.name === skillName && installation.status === 'outdated'
  )
  return (
    <span className="inline-flex items-center gap-2">
      {statusPill(status)}
      {hasOutdatedCopy ? (
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
