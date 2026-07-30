import { useMemo, useState } from 'react'
import { LinearApiKeyDialog } from '@/components/linear-api-key-dialog'
import { Button } from '@/components/ui/button'
import {
  AGENT_SKILL_CLI_PREREQUISITE_NOTICE,
  ensureOrcaCliAvailableForAgentSkillTerminal
} from '@/lib/agent-skill-cli-prerequisite'
import {
  LINEAR_AGENT_SKILL_NAMES,
  ORCA_LINEAR_SKILL_INSTALL_COMMAND
} from '@/lib/agent-feature-install-commands'
import { getLinearAgentSkillUpdateTarget } from '@/lib/linear-agent-skill-update-command'
import {
  GLOBAL_AGENT_SKILL_SOURCE_KINDS,
  useInstalledAgentSkillNames
} from '@/hooks/useInstalledAgentSkills'
import { useActiveProjectSkillRuntime } from '@/hooks/useActiveProjectSkillRuntime'
import { useAppStore } from '@/store'
import { AgentSkillSetupPanel } from './AgentSkillSetupPanel'
import {
  buildSkillCommandForRuntime,
  ensureWslCliAvailableForAgentSkillTerminal,
  getWslCliDistroRequest
} from './CliSkillRuntimeSetup'
import { TaskSourceShowInTasksStep } from './TaskSourceShowInTasksStep'
import { TaskSourceStepRow } from './TaskSourceStepRow'
import { translate } from '@/i18n/i18n'

type TaskSourceLinearSetupProps = {
  connected: boolean
  checking: boolean
  visible: boolean
  onToggleVisible: () => void
  canHide: boolean
}

// Keep connection, skill install, and visibility in the same guided flow.
export function TaskSourceLinearSetup({
  connected,
  checking,
  visible,
  onToggleVisible,
  canHide
}: TaskSourceLinearSetupProps): React.JSX.Element {
  const checkLinearConnection = useAppStore((s) => s.checkLinearConnection)
  const [dialogOpen, setDialogOpen] = useState(false)
  const activeSkillRuntime = useActiveProjectSkillRuntime()

  const {
    installed: skillInstalled,
    loading: skillLoading,
    error: skillError,
    skills: linearSkills,
    refresh: refreshSkill
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
    () => getLinearAgentSkillUpdateTarget(linearSkills, skillInstalled),
    [linearSkills, skillInstalled]
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

  const connectState = checking ? 'in-progress' : connected ? 'done' : 'pending'
  // Skill install is independent of API connection; only gate the first-time install CTA.
  const skillState = skillLoading ? 'in-progress' : skillInstalled ? 'done' : 'pending'
  // Keep the panel visible while scanning so we don't flash "connect first" over an installed skill.
  const skillInstallBlocked = !connected && !skillInstalled && !skillLoading

  return (
    <>
      <ol className="divide-y divide-border/50">
        <TaskSourceStepRow
          index={1}
          state={connectState}
          title={translate(
            'auto.components.settings.TaskSourceLinearSetup.connectTitle',
            'Connect Linear'
          )}
          description={translate(
            'auto.components.settings.TaskSourceLinearSetup.connectDescription',
            'Add a Personal API key so Orca can browse issues and open workspaces with ticket context.'
          )}
          action={
            <Button
              type="button"
              size="sm"
              variant={connected ? 'outline' : 'default'}
              onClick={() => setDialogOpen(true)}
            >
              {connected
                ? translate(
                    'auto.components.settings.TaskSourceLinearSetup.manageAccess',
                    'Manage access'
                  )
                : translate(
                    'auto.components.settings.TaskSourceLinearSetup.addAccess',
                    'Add Linear access'
                  )}
            </Button>
          }
        >
          {connected ? (
            <p className="text-[11px] text-muted-foreground">
              {translate(
                'auto.components.settings.TaskSourceLinearSetup.connectedHint',
                'Workspaces and keys are stored for the active runtime. You can add more access any time.'
              )}
            </p>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => void checkLinearConnection(true)}
            >
              {translate(
                'auto.components.settings.TaskSourceLinearSetup.recheck',
                'Re-check connection'
              )}
            </Button>
          )}
        </TaskSourceStepRow>

        <TaskSourceStepRow
          index={2}
          state={skillState}
          title={translate(
            'auto.components.settings.TaskSourceLinearSetup.skillTitle',
            'Install Linear agent skill'
          )}
          description={translate(
            'auto.components.settings.TaskSourceLinearSetup.skillDescription',
            'Gives agents the /orca-linear skill to read tickets, post updates, move states, and attach PRs.'
          )}
          className={skillInstallBlocked ? 'opacity-60' : undefined}
        >
          {skillInstallBlocked ? (
            <p className="text-[11px] text-muted-foreground">
              {translate(
                'auto.components.settings.TaskSourceLinearSetup.skillBlocked',
                'Connect Linear first, then install the skill for agents.'
              )}
            </p>
          ) : (
            <AgentSkillSetupPanel
              variant="inline"
              hideHeader
              title={translate(
                'auto.components.settings.TaskSourceLinearSetup.skillPanelTitle',
                'Linear skill'
              )}
              description={null}
              command={installCommand}
              installedCommand={updateCommand}
              terminalTitle={translate(
                'auto.components.settings.TaskSourceLinearSetup.terminalTitle',
                'Linear skill setup'
              )}
              terminalAriaLabel={translate(
                'auto.components.settings.TaskSourceLinearSetup.terminalAriaLabel',
                'Linear skill install terminal'
              )}
              terminalWorktreeId="settings-tasks-linear-skill-terminal"
              terminalShellOverride={activeSkillRuntime.terminalShellOverride}
              installed={skillInstalled}
              loading={skillLoading}
              error={activeSkillRuntime.installDisabledReason ?? skillError}
              installDisabled={Boolean(activeSkillRuntime.installDisabledReason)}
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
              onRecheck={refreshSkill}
              freshnessSkillName={
                activeSkillRuntime.agentRuntime?.runtime === 'wsl'
                  ? undefined
                  : updateTarget.skillName
              }
            />
          )}
        </TaskSourceStepRow>

        <TaskSourceShowInTasksStep
          index={3}
          providerLabel={translate('auto.components.settings.TasksPane.09ae2d7c51', 'Linear')}
          visible={visible}
          canHide={canHide}
          onToggleVisible={onToggleVisible}
          description={translate(
            'auto.components.settings.TaskSourceLinearSetup.showDescription',
            'Include Linear in the Tasks page source picker and sidebar shortcuts.'
          )}
        />
      </ol>

      <LinearApiKeyDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        connectLabel={translate(
          'auto.components.settings.TaskSourceLinearSetup.addAccess',
          'Add Linear access'
        )}
        onConnected={() => {
          void checkLinearConnection(true)
        }}
      />
    </>
  )
}
