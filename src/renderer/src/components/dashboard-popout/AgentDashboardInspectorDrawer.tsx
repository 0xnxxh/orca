import { useCallback, useState } from 'react'
import { SquareArrowOutUpRight, XIcon } from 'lucide-react'
import { AgentIcon } from '@/lib/agent-catalog'
import { agentTypeToIconAgent, formatAgentTypeLabel } from '@/lib/agent-status'
import { agentStateLabel } from '@/components/AgentStateDot'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { translate } from '@/i18n/i18n'
import type { DashboardCard } from '../../../../shared/dashboard-snapshot'
import { AgentChatPanel } from './AgentChatPanel'
import { AgentTerminalPreview } from './AgentTerminalPreview'

export type AgentRevealArgs = {
  repoId: string
  worktreeId: string
  tabId: string
  leafId: string | null
}

type AgentDashboardInspectorDrawerProps = {
  card: DashboardCard
  onOpenChange: (open: boolean) => void
  onReveal: (args: AgentRevealArgs) => void
}

/** Dashboard card details slide from the window edge without shrinking the board. */
export function AgentDashboardInspectorDrawer({
  card,
  onOpenChange,
  onReveal
}: AgentDashboardInspectorDrawerProps): React.JSX.Element {
  const [showTerminal, setShowTerminal] = useState(card.viewMode !== 'chat')
  const reveal = useCallback(() => {
    onReveal({
      repoId: card.repoId,
      worktreeId: card.worktreeId,
      tabId: card.tabId,
      leafId: card.leafId
    })
    onOpenChange(false)
  }, [card, onOpenChange, onReveal])

  return (
    <Sheet open modal={false} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        showCloseButton={false}
        overlayClassName="hidden"
        aria-describedby={undefined}
        className="w-[min(42rem,calc(100vw-3rem))] p-0 sm:max-w-none"
        onEscapeKeyDown={(event) => {
          if (event.target instanceof HTMLElement && event.target.closest('.xterm')) {
            event.preventDefault()
          }
        }}
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <SheetTitle className="sr-only">
          {translate('dashboardPopout.inspector.title', 'Agent details')}
        </SheetTitle>
        {showTerminal ? (
          <div className="flex min-h-0 flex-1 flex-col bg-background text-foreground">
            <header className="flex items-center gap-1.5 border-b border-border px-2.5 py-2">
              <span className="inline-flex shrink-0">
                <AgentIcon agent={agentTypeToIconAgent(card.agentType)} size={13} />
              </span>
              <h2 className="text-[12px] leading-normal font-semibold">{card.worktreeName}</h2>
              <span className="text-[11px] text-muted-foreground">
                {formatAgentTypeLabel(card.agentType)} · {agentStateLabel(card.dotState)}
              </span>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                aria-label={translate('dashboardPopout.terminal.close', 'Close')}
                className="ml-auto rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:outline-hidden"
              >
                <XIcon className="size-4" />
              </button>
            </header>
            {card.ptyId ? (
              <AgentTerminalPreview ptyId={card.ptyId} terminalInput={card.terminalInput ?? null} />
            ) : (
              <div className="px-2.5 py-2 text-[11px] text-muted-foreground">
                {translate(
                  'dashboardPopout.terminal.closed',
                  "No live terminal — this agent's pane has closed."
                )}
              </div>
            )}
            <div className="flex items-center justify-end border-t border-border px-2.5 py-1.5">
              <Button type="button" variant="outline" size="xs" onClick={reveal}>
                <SquareArrowOutUpRight className="size-3" />
                {translate('dashboardPopout.terminal.focusWorktree', 'Open worktree')}
              </Button>
            </div>
          </div>
        ) : (
          <AgentChatPanel
            card={card}
            onClose={() => onOpenChange(false)}
            onOpenTerminal={() => setShowTerminal(true)}
            className="m-0 h-full flex-none rounded-none border-0 bg-transparent shadow-none"
          />
        )}
      </SheetContent>
    </Sheet>
  )
}
