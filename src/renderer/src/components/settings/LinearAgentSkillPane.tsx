import { useMemo, useState } from 'react'
import { ArrowRightCircle, BookOpen, Link2, ListTodo, MessageSquarePlus } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { LinearApiKeyDialog } from '@/components/linear-api-key-dialog'
import { LinearIcon } from '@/components/icons/LinearIcon'
import { useAppStore } from '@/store'
import {
  LINEAR_AGENT_SKILL_NAMES,
  ORCA_LINEAR_SKILL_INSTALL_COMMAND,
  ORCA_LINEAR_SKILL_NAME
} from '@/lib/agent-feature-install-commands'
import {
  AGENT_SKILL_CLI_PREREQUISITE_NOTICE,
  ensureOrcaCliAvailableForAgentSkillTerminal
} from '@/lib/agent-skill-cli-prerequisite'
import { getLinearAgentSkillUpdateTarget } from '@/lib/linear-agent-skill-update-command'
import { getLinearUsageExamples } from '@/lib/linear-usage-examples'
import type { SkillUsageExample } from '@/lib/skill-usage-example'
import {
  GLOBAL_AGENT_SKILL_SOURCE_KINDS,
  useInstalledAgentSkillNames
} from '@/hooks/useInstalledAgentSkills'
import { useActiveProjectSkillRuntime } from '@/hooks/useActiveProjectSkillRuntime'
import { useLinearProviderConnected } from '@/hooks/useLinearProviderConnected'
import { normalizeVisibleTaskProviders } from '../../../../shared/task-providers'
import { getProviderRuntimeContextKey } from '@/lib/provider-runtime-context'
import { AgentSkillSetupPanel } from './AgentSkillSetupPanel'
import {
  buildSkillCommandForRuntime,
  ensureWslCliAvailableForAgentSkillTerminal,
  getWslCliDistroRequest
} from './CliSkillRuntimeSetup'
import { LinearAgentSkillGuide } from './LinearAgentSkillGuide'
import { LinearAgentSkillNotes } from './LinearAgentSkillNotes'
import { getLinearAgentSkillPaneSearchEntries } from './linear-agent-skill-search'
import { SearchableSetting } from './SearchableSetting'
import { SkillUsageExamplesSection } from './SkillUsageExamplesSection'
import { translate } from '@/i18n/i18n'
export { getLinearAgentSkillPaneSearchEntries } from './linear-agent-skill-search'

const LINEAR_EXAMPLE_ICONS: Record<string, LucideIcon> = {
  'read-ticket': BookOpen,
  'post-update': MessageSquarePlus,
  'move-state': ArrowRightCircle,
  'attach-pr': Link2,
  'triage-followups': ListTodo
}

function resolveLinearExampleIcon(example: SkillUsageExample): LucideIcon {
  return LINEAR_EXAMPLE_ICONS[example.id] ?? LinearIcon
}

// Keep Linear education, skill management, and example prompts in one place.
export function LinearAgentSkillPane(): React.JSX.Element {
  const activeSkillRuntime = useActiveProjectSkillRuntime()
  const openSettingsPage = useAppStore((state) => state.openSettingsPage)
  const openSettingsTarget = useAppStore((state) => state.openSettingsTarget)
  const settings = useAppStore((state) => state.settings)
  const linearStatusChecked = useAppStore((state) => state.linearStatusChecked)
  const linearStatusContextKey = useAppStore((state) => state.linearStatusContextKey)
  const linearConnected = useLinearProviderConnected()
  const checkLinearConnection = useAppStore((state) => state.checkLinearConnection)
  const [linearKeyDialogOpen, setLinearKeyDialogOpen] = useState(false)

  const openTaskSources = (): void => {
    openSettingsPage()
    openSettingsTarget({ pane: 'tasks', repoId: null })
  }

  const {
    installed: linearSkillInstalled,
    loading: linearSkillLoading,
    error: linearSkillError,
    skills: linearSkills,
    refresh: refreshLinearSkill
  } = useInstalledAgentSkillNames(LINEAR_AGENT_SKILL_NAMES, {
    discoveryTarget: activeSkillRuntime.discoveryTarget,
    sourceKinds: GLOBAL_AGENT_SKILL_SOURCE_KINDS
  })

  const installCommand = useMemo(
    () =>
      activeSkillRuntime.installDisabledReason
        ? ORCA_LINEAR_SKILL_INSTALL_COMMAND
        : buildSkillCommandForRuntime(
            ORCA_LINEAR_SKILL_INSTALL_COMMAND,
            activeSkillRuntime.agentRuntime
          ),
    [activeSkillRuntime.agentRuntime, activeSkillRuntime.installDisabledReason]
  )
  const updateTarget = useMemo(
    () => getLinearAgentSkillUpdateTarget(linearSkills, linearSkillInstalled),
    [linearSkillInstalled, linearSkills]
  )
  const updateCommand = useMemo(() => {
    const command = updateTarget.command
    return activeSkillRuntime.installDisabledReason
      ? command
      : buildSkillCommandForRuntime(command, activeSkillRuntime.agentRuntime)
  }, [
    activeSkillRuntime.agentRuntime,
    activeSkillRuntime.installDisabledReason,
    updateTarget.command
  ])

  const visibleInTasks = normalizeVisibleTaskProviders(settings?.visibleTaskProviders).includes(
    'linear'
  )
  const connectionChecking =
    linearStatusContextKey !== getProviderRuntimeContextKey(settings) || !linearStatusChecked

  return (
    <SearchableSetting
      title={translate('auto.components.settings.LinearAgentSkillPane.title', 'Linear')}
      description={translate(
        'auto.components.settings.LinearAgentSkillPane.description',
        'How Linear works in Orca: browse issues, start linked workspaces, and let agents update tickets with /orca-linear.'
      )}
      keywords={getLinearAgentSkillPaneSearchEntries()[0].keywords}
      className="space-y-6 py-2"
    >
      <LinearAgentSkillGuide
        status={{
          connected: linearConnected,
          connectionChecking,
          skillInstalled: linearSkillInstalled,
          skillChecking: linearSkillLoading,
          visibleInTasks
        }}
        onOpenTaskSources={openTaskSources}
        onManageLinearAccess={() => setLinearKeyDialogOpen(true)}
      />

      <div id="linear-agent-skill-install" className="space-y-3 scroll-mt-4">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-foreground">
            {translate(
              'auto.components.settings.LinearAgentSkillPane.skillSectionTitle',
              'Agent skill'
            )}
          </h3>
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.LinearAgentSkillPane.skillSectionBody',
              'Install or update the skill agents need. You can also complete this step from Task Sources during first-time setup.'
            )}
          </p>
        </div>

        <AgentSkillSetupPanel
          title={translate(
            'auto.components.settings.LinearAgentSkillPane.skillTitle',
            'Linear skill'
          )}
          description={translate(
            'auto.components.settings.LinearAgentSkillPane.skillDescription',
            'Enables agents to read linked tickets and post updates to Linear through Orca.'
          )}
          command={installCommand}
          installedCommand={updateCommand}
          terminalTitle={translate(
            'auto.components.settings.LinearAgentSkillPane.terminalTitle',
            'Linear skill setup'
          )}
          terminalAriaLabel={translate(
            'auto.components.settings.LinearAgentSkillPane.terminalAriaLabel',
            'Linear skill install terminal'
          )}
          terminalWorktreeId="settings-linear-skill-terminal"
          terminalShellOverride={activeSkillRuntime.terminalShellOverride}
          installed={linearSkillInstalled}
          loading={linearSkillLoading}
          error={activeSkillRuntime.installDisabledReason ?? linearSkillError}
          installDisabled={Boolean(activeSkillRuntime.installDisabledReason)}
          icon={<LinearIcon className="size-5" />}
          preInstallNotice={AGENT_SKILL_CLI_PREREQUISITE_NOTICE}
          getPrerequisiteStatus={() =>
            activeSkillRuntime.agentRuntime?.runtime === 'wsl'
              ? window.api.cli.getWslInstallStatus(
                  getWslCliDistroRequest(activeSkillRuntime.agentRuntime)
                )
              : window.api.cli.getInstallStatus()
          }
          onBeforeOpenTerminal={async () => {
            await (activeSkillRuntime.agentRuntime?.runtime === 'wsl'
              ? ensureWslCliAvailableForAgentSkillTerminal(activeSkillRuntime.agentRuntime)
              : ensureOrcaCliAvailableForAgentSkillTerminal())
          }}
          onRecheck={refreshLinearSkill}
          // Freshness cannot verify WSL, so report presence there.
          freshnessSkillName={
            activeSkillRuntime.agentRuntime?.runtime === 'wsl' ? undefined : updateTarget.skillName
          }
        />
      </div>

      <SkillUsageExamplesSection
        heading={translate(
          'auto.components.settings.LinearAgentSkillPane.howToUse',
          'Example prompts'
        )}
        description={translate(
          'auto.components.settings.LinearAgentSkillPane.howToUseDescription',
          'Click a card to copy a prompt. Use these in a Linear-linked worktree after the skill is installed.'
        )}
        examples={getLinearUsageExamples()}
        resolveIcon={resolveLinearExampleIcon}
        slashCommand={`/${ORCA_LINEAR_SKILL_NAME}`}
      />

      <LinearAgentSkillNotes />

      <LinearApiKeyDialog
        open={linearKeyDialogOpen}
        onOpenChange={setLinearKeyDialogOpen}
        connectLabel={
          linearConnected
            ? translate('auto.components.settings.LinearAgentSkillGuide.manageKeys', 'Manage keys')
            : translate('auto.components.settings.LinearAgentSkillGuide.addAccess', 'Add access')
        }
        onConnected={() => {
          void checkLinearConnection(true)
        }}
      />
    </SearchableSetting>
  )
}
