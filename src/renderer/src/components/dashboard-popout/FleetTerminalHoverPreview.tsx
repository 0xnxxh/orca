import { Terminal } from 'lucide-react'
import { agentStateLabel } from '@/components/AgentStateDot'
import { formatAgentTypeLabel } from '@/lib/agent-status'
import { translate } from '@/i18n/i18n'
import type { DashboardCard } from '../../../../shared/dashboard-snapshot'
import { FleetTerminalStreamPreview } from './FleetTerminalStreamPreview'

type FleetTerminalHoverPreviewProps = {
  card: DashboardCard
  left: number
  top: number
}

export function FleetTerminalHoverPreview({
  card,
  left,
  top
}: FleetTerminalHoverPreviewProps): React.JSX.Element {
  const name = card.conversationName ?? formatAgentTypeLabel(card.agentType)

  return (
    <section
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute z-20 w-72 overflow-hidden rounded-lg border border-ring bg-popover text-popover-foreground shadow-[0_10px_24px_rgba(0,0,0,0.18)]"
      style={{ left, top }}
      data-testid="fleet-terminal-hover-preview"
    >
      <header className="flex min-w-0 items-center gap-2 border-b border-border px-2.5 py-2">
        <Terminal className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0">
          <strong className="block truncate text-xs font-semibold">{name}</strong>
          <span className="block truncate text-[11px] text-muted-foreground">
            {card.worktreeName} · {agentStateLabel(card.dotState)}
          </span>
        </span>
        <span className="ml-auto text-[10px] font-semibold uppercase tracking-[0.05em] text-status-success">
          {card.ptyId
            ? translate('dashboardPopout.map.live', 'Live')
            : translate('dashboardPopout.map.snapshot', 'Snapshot')}
        </span>
      </header>
      {card.ptyId ? (
        <FleetTerminalStreamPreview ptyId={card.ptyId} />
      ) : (
        <p className="line-clamp-5 min-h-24 whitespace-pre-wrap px-2.5 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
          {card.lastAgentMessage ||
            card.task ||
            translate(
              'dashboardPopout.terminal.closed',
              "No live terminal — this agent's pane has closed."
            )}
        </p>
      )}
      <footer className="border-t border-border px-2.5 py-1.5 text-[10px] text-muted-foreground">
        {translate('dashboardPopout.map.clickToPin', 'Click agent to pin')}
      </footer>
    </section>
  )
}
