import { Settings } from 'lucide-react'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { SettingsSegmentedControl, SettingsSwitch } from '../settings/SettingsFormControls'
import type { AgentDashboardAgentViewMode, AgentDashboardMode } from '../../../../shared/types'
import { translate } from '@/i18n/i18n'

type AgentDashboardSettingsMenuProps = {
  /** Called after the mode switches to pop-out so the host can hand the board
   *  over to the pop-out window instead of leaving a stale in-window board. */
  onSwitchToPopout?: () => void
  /** Lets the host keep the companion board open while this menu owns the
   *  next outside click, matching the workspace board's menu handling. */
  onOpenChange?: (open: boolean) => void
  /** The detached window omits the redundant in-window/pop-out handoff control. */
  showOpenMode?: boolean
}

/** Shared dashboard settings for the in-window and pop-out headers. */
export function AgentDashboardSettingsMenu({
  onSwitchToPopout,
  onOpenChange,
  showOpenMode = true
}: AgentDashboardSettingsMenuProps): React.JSX.Element {
  const mode = useAppStore((s) => s.settings?.experimentalAgentDashboardMode ?? 'in-window')
  const agentViewMode = useAppStore(
    (s) => s.settings?.experimentalAgentDashboardAgentViewMode ?? 'terminal'
  )
  const showIdle = useAppStore((s) => s.settings?.experimentalAgentDashboardShowIdle === true)
  const updateSettings = useAppStore((s) => s.updateSettings)

  const handleModeChange = (next: AgentDashboardMode): void => {
    if (next === mode) {
      return
    }
    updateSettings({ experimentalAgentDashboardMode: next })
    if (next === 'popout') {
      onSwitchToPopout?.()
    }
  }

  const handleAgentViewModeChange = (next: AgentDashboardAgentViewMode): void => {
    if (next !== agentViewMode) {
      void updateSettings({ experimentalAgentDashboardAgentViewMode: next })
    }
  }

  return (
    <DropdownMenu modal={false} onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={translate('dashboardPopout.settingsLabel', 'Agent Dashboard settings')}
              className="text-muted-foreground"
            >
              <Settings className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={4}>
          {translate('dashboardPopout.settingsTooltip', 'Board settings')}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" sideOffset={8} collisionPadding={8} className="w-72 p-2">
        {showOpenMode ? (
          <>
            <div className="flex items-start justify-between gap-3 rounded-md px-1.5 py-1.5">
              <span className="min-w-0 space-y-0.5">
                <span className="block text-[12px] font-medium leading-4 text-foreground">
                  {translate(
                    'auto.components.settings.ExperimentalPane.agentDashboard.modeLabel',
                    'Open as'
                  )}
                </span>
                <span className="block text-[11px] leading-4 text-muted-foreground">
                  {translate(
                    'auto.components.settings.ExperimentalPane.agentDashboard.modeCopy',
                    'Show the dashboard as an in-window board beside the sidebar or a separate pop-out window.'
                  )}
                </span>
              </span>
            </div>
            <div className="px-1.5 pb-1">
              <SettingsSegmentedControl
                value={mode}
                onChange={handleModeChange}
                ariaLabel={translate(
                  'auto.components.settings.ExperimentalPane.agentDashboard.modeAriaLabel',
                  'Agent Dashboard open mode'
                )}
                size="sm"
                equalWidth
                options={[
                  {
                    value: 'in-window',
                    label: translate(
                      'auto.components.settings.ExperimentalPane.agentDashboard.modeInWindow',
                      'In-window'
                    )
                  },
                  {
                    value: 'popout',
                    label: translate(
                      'auto.components.settings.ExperimentalPane.agentDashboard.modePopout',
                      'Pop-out'
                    )
                  }
                ]}
              />
            </div>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <div className="space-y-0.5 rounded-md px-1.5 py-1.5">
          <span className="block text-[12px] font-medium leading-4 text-foreground">
            {translate('dashboardPopout.settings.agentView', 'Open agents in')}
          </span>
          <span className="block text-[11px] leading-4 text-muted-foreground">
            {translate(
              'dashboardPopout.settings.agentViewCopy',
              'Choose the native transcript drawer or the live terminal preview.'
            )}
          </span>
        </div>
        <div className="px-1.5 pb-1">
          <SettingsSegmentedControl
            value={agentViewMode}
            onChange={handleAgentViewModeChange}
            ariaLabel={translate('dashboardPopout.settings.agentView', 'Open agents in')}
            size="sm"
            equalWidth
            options={[
              {
                value: 'native-chat',
                label: translate('dashboardPopout.settings.nativeChat', 'Native chat')
              },
              {
                value: 'terminal',
                label: translate('dashboardPopout.settings.terminal', 'Terminal')
              }
            ]}
          />
        </div>
        <DropdownMenuSeparator />
        <div className="flex items-start justify-between gap-3 rounded-md px-1.5 py-1.5">
          <span className="min-w-0 space-y-0.5">
            <span className="block text-[12px] font-medium leading-4 text-foreground">
              {translate('dashboardPopout.settings.showIdle', 'Show idle agents')}
            </span>
            <span className="block text-[11px] leading-4 text-muted-foreground">
              {translate(
                'dashboardPopout.settings.showIdleCopy',
                'Include agents that have gone quiet for 30 minutes without reporting completion. Hidden by default.'
              )}
            </span>
          </span>
          <SettingsSwitch
            checked={showIdle}
            onChange={() => {
              void updateSettings({ experimentalAgentDashboardShowIdle: !showIdle })
            }}
            ariaLabel={translate('dashboardPopout.settings.showIdle', 'Show idle agents')}
          />
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
