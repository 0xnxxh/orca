import { ChartNoAxesGantt, Columns3, Orbit } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { AgentDashboardView } from './agent-dashboard-view'

// 'cells' is intentionally not offered for now; the view stays reachable via ?view=cells.
const VIEW_OPTIONS: readonly {
  id: AgentDashboardView
  icon: typeof Columns3
}[] = [
  { id: 'board', icon: Columns3 },
  { id: 'lanes', icon: ChartNoAxesGantt },
  { id: 'map', icon: Orbit }
]

function viewLabel(view: AgentDashboardView): string {
  switch (view) {
    case 'board':
      return translate('dashboardPopout.view.board', 'Dashboard')
    case 'lanes':
      return translate('dashboardPopout.view.lanes', 'Activity Lanes')
    case 'map':
      return translate('dashboardPopout.view.map', 'Agent Map')
    case 'cells':
      return translate('dashboardPopout.view.cells', 'Cells')
  }
}

export function AgentDashboardViewSelector({
  view,
  onViewChange
}: {
  view: AgentDashboardView
  onViewChange: (view: AgentDashboardView) => void
}): React.JSX.Element {
  return (
    <div
      className="flex items-center gap-0.5 rounded-md border border-border p-0.5"
      role="group"
      aria-label={translate('dashboardPopout.view.label', 'Dashboard view')}
    >
      {VIEW_OPTIONS.map((option) => {
        const Icon = option.icon
        return (
          <Button
            key={option.id}
            type="button"
            variant="ghost"
            size="xs"
            aria-pressed={view === option.id}
            className={cn('h-6 gap-1 px-2', view === option.id && 'bg-accent')}
            onClick={() => onViewChange(option.id)}
          >
            <Icon className="size-3" />
            {viewLabel(option.id)}
          </Button>
        )
      })}
    </div>
  )
}
