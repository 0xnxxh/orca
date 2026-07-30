import { Check, Circle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IntegrationStatusPill } from '@/components/integration-status-pill'
import { translate } from '@/i18n/i18n'

export type LinearSetupStepStatus = {
  connected: boolean
  connectionChecking: boolean
  skillInstalled: boolean
  skillChecking: boolean
  visibleInTasks: boolean
}

type LinearAgentSkillGuideProps = {
  status: LinearSetupStepStatus
  onOpenTaskSources: () => void
  onManageLinearAccess: () => void
}

function SetupStatusIcon({
  done,
  checking
}: {
  done: boolean
  checking: boolean
}): React.JSX.Element {
  if (checking) {
    return (
      <Circle className="size-3.5 animate-pulse text-muted-foreground motion-reduce:animate-none" />
    )
  }
  if (done) {
    return (
      <span className="flex size-5 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
        <Check className="size-3" />
      </span>
    )
  }
  return (
    <span className="flex size-5 items-center justify-center rounded-full border border-border/70 text-muted-foreground">
      <Circle className="size-2.5" />
    </span>
  )
}

// Explain how connection, skill install, and Tasks visibility fit together.
export function LinearAgentSkillGuide({
  status,
  onOpenTaskSources,
  onManageLinearAccess
}: LinearAgentSkillGuideProps): React.JSX.Element {
  const setupRows: {
    id: string
    done: boolean
    checking: boolean
    title: string
    body: string
    actionLabel: string
    onAction: () => void
  }[] = [
    {
      id: 'connect',
      done: status.connected,
      checking: status.connectionChecking,
      title: translate(
        'auto.components.settings.LinearAgentSkillGuide.setupConnectTitle',
        '1. Connect Linear'
      ),
      body: translate(
        'auto.components.settings.LinearAgentSkillGuide.setupConnectBody',
        'Personal API key so Orca can list issues and open linked workspaces.'
      ),
      actionLabel: status.connected
        ? translate('auto.components.settings.LinearAgentSkillGuide.manageKeys', 'Manage keys')
        : translate('auto.components.settings.LinearAgentSkillGuide.addAccess', 'Add access'),
      onAction: onManageLinearAccess
    },
    {
      id: 'skill',
      done: status.skillInstalled,
      checking: status.skillChecking,
      title: translate(
        'auto.components.settings.LinearAgentSkillGuide.setupSkillTitle',
        '2. Install the agent skill'
      ),
      body: translate(
        'auto.components.settings.LinearAgentSkillGuide.setupSkillBody',
        'Gives coding agents /orca-linear for read, update, triage, and PR attach.'
      ),
      actionLabel: status.skillInstalled
        ? translate('auto.components.settings.LinearAgentSkillGuide.skillReady', 'Ready below')
        : translate('auto.components.settings.LinearAgentSkillGuide.installBelow', 'Install below'),
      onAction: () => {
        const behavior =
          window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
            ? 'auto'
            : 'smooth'
        document
          .getElementById('linear-agent-skill-install')
          ?.scrollIntoView({ behavior, block: 'start' })
      }
    },
    {
      id: 'visible',
      done: status.visibleInTasks,
      checking: false,
      title: translate(
        'auto.components.settings.LinearAgentSkillGuide.setupVisibleTitle',
        '3. Show Linear in Tasks'
      ),
      body: translate(
        'auto.components.settings.LinearAgentSkillGuide.setupVisibleBody',
        'Keeps Linear in the Tasks source picker and sidebar shortcuts.'
      ),
      actionLabel: translate(
        'auto.components.settings.LinearAgentSkillGuide.openTaskSources',
        'Task Sources'
      ),
      onAction: onOpenTaskSources
    }
  ]

  const completed = setupRows.filter((row) => row.done && !row.checking).length
  const allReady = completed === setupRows.length && setupRows.every((row) => !row.checking)

  return (
    <section className="space-y-3 rounded-xl border border-border/60 bg-card/30 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-0.5">
          <h3 className="text-sm font-semibold text-foreground">
            {translate(
              'auto.components.settings.LinearAgentSkillGuide.setupTitle',
              'Setup checklist'
            )}
          </h3>
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.LinearAgentSkillGuide.setupBody',
              'All three are required for the full Tasks + agent loop. First-time path is also under Task Sources.'
            )}
          </p>
        </div>
        <IntegrationStatusPill tone={allReady ? 'connected' : 'attention'}>
          {allReady
            ? translate('auto.components.settings.LinearAgentSkillGuide.setupReady', 'All set')
            : translate(
                'auto.components.settings.LinearAgentSkillGuide.setupProgress',
                '{{done}} of {{total}} ready',
                { done: completed, total: setupRows.length }
              )}
        </IntegrationStatusPill>
      </div>

      <div className="divide-y divide-border/50">
        {setupRows.map((row) => (
          <div key={row.id} className="flex flex-wrap items-start gap-3 py-3">
            <div className="mt-0.5">
              <SetupStatusIcon done={row.done} checking={row.checking} />
            </div>
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="text-sm font-medium text-foreground">{row.title}</p>
              <p className="text-xs text-muted-foreground">{row.body}</p>
            </div>
            <Button
              type="button"
              size="sm"
              variant={row.done ? 'outline' : 'default'}
              className="shrink-0"
              onClick={row.onAction}
            >
              {row.actionLabel}
            </Button>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-muted-foreground">
        {translate(
          'auto.components.settings.LinearAgentSkillGuide.setupHint',
          'Prefer one guided place for connect + skill + visibility?'
        )}{' '}
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto p-0 text-[11px] align-baseline"
          onClick={onOpenTaskSources}
        >
          {translate(
            'auto.components.settings.LinearAgentSkillGuide.openFullSetup',
            'Open Task Sources setup'
          )}
        </Button>
      </p>
    </section>
  )
}
