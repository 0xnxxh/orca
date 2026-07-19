import React from 'react'
import { List, Network } from 'lucide-react'

import { AgentIcon } from '@/lib/agent-catalog'
import { agentTypeToIconAgent, formatAgentTypeLabel } from '@/lib/agent-status'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'

import type { ActivityCanvasAgentState, ActivityCanvasNode } from './activity-canvas-types'

export type ActivityViewMode = 'list' | 'canvas'

export const ACTIVITY_CANVAS_STATUS_SURFACE: Record<
  ActivityCanvasAgentState,
  { surface: string; accent: string; label: string }
> = {
  working: {
    surface:
      'bg-amber-500/12 text-amber-950 border-amber-500/35 dark:bg-amber-400/12 dark:text-amber-50 dark:border-amber-400/30',
    accent: 'rgb(245 158 11)',
    label: 'WORKING'
  },
  blocked: {
    surface:
      'bg-red-500/12 text-red-950 border-red-500/35 dark:bg-red-400/12 dark:text-red-50 dark:border-red-400/30',
    accent: 'rgb(239 68 68)',
    label: 'BLOCKED'
  },
  waiting: {
    surface:
      'bg-orange-500/12 text-orange-950 border-orange-500/35 dark:bg-orange-400/12 dark:text-orange-50 dark:border-orange-400/30',
    accent: 'rgb(249 115 22)',
    label: 'WAITING'
  },
  done: {
    surface:
      'bg-emerald-500/12 text-emerald-950 border-emerald-500/35 dark:bg-emerald-400/12 dark:text-emerald-50 dark:border-emerald-400/30',
    accent: 'rgb(16 185 129)',
    label: 'DONE'
  },
  interrupted: {
    surface:
      'bg-neutral-500/12 text-neutral-900 border-neutral-500/30 dark:bg-neutral-400/10 dark:text-neutral-50 dark:border-neutral-400/25',
    accent: 'rgb(115 115 115)',
    label: 'INTERRUPTED'
  }
}

export function ActivityViewModeToggle({
  value,
  onChange,
  className
}: {
  value: ActivityViewMode
  onChange: (mode: ActivityViewMode) => void
  className?: string
}): React.JSX.Element {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(next) => {
        if (next === 'list' || next === 'canvas') {
          onChange(next)
        }
      }}
      variant="outline"
      size="sm"
      spacing={0}
      className={cn('shrink-0', className)}
      aria-label={translate(
        'auto.components.activity.ActivityAgentsCanvas.viewMode',
        'Agents view mode'
      )}
    >
      <ToggleGroupItem value="list" className="h-8 gap-1.5 px-2.5 text-xs" aria-label="List view">
        <List className="size-3.5" />
        <span className="hidden sm:inline">List</span>
      </ToggleGroupItem>
      <ToggleGroupItem
        value="canvas"
        className="h-8 gap-1.5 px-2.5 text-xs"
        aria-label="Canvas view"
      >
        <Network className="size-3.5" />
        <span className="hidden sm:inline">Canvas</span>
      </ToggleGroupItem>
    </ToggleGroup>
  )
}

export function ActivityCanvasNodeCard({
  node,
  selected,
  onSelect
}: {
  node: ActivityCanvasNode
  selected: boolean
  onSelect: () => void
}): React.JSX.Element {
  const theme = ACTIVITY_CANVAS_STATUS_SURFACE[node.thread.agentState]
  const title =
    node.thread.paneTitle.trim().length > 0 ? node.thread.paneTitle : node.thread.workspaceTitle
  const subtitle =
    title !== node.thread.workspaceTitle ? node.thread.workspaceTitle : node.thread.projectLabel

  return (
    <button
      type="button"
      data-testid="activity-canvas-node"
      data-pane-key={node.id}
      data-selected={selected ? 'true' : undefined}
      data-isolated={node.isolated ? 'true' : undefined}
      onClick={(event) => {
        event.stopPropagation()
        onSelect()
      }}
      className={cn(
        'group absolute flex cursor-pointer flex-col gap-1 rounded-xl border py-2 pr-2.5 pl-4 text-left shadow-sm transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-md',
        theme.surface,
        selected && 'outline-2 outline-offset-2 outline-ring shadow-md'
      )}
      style={{
        left: node.x,
        top: node.y,
        width: node.width,
        height: node.height
      }}
    >
      {/* Agent stripe — identity channel; status owns the fill (orca-viz rule). */}
      <span
        aria-hidden
        className="absolute top-2 bottom-2 left-1.5 w-[4px] rounded-full"
        style={{
          background: node.agent.colour,
          boxShadow: `0 0 10px 0 color-mix(in srgb, ${node.agent.colour} 55%, transparent)`
        }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-xl"
        style={{
          background: `linear-gradient(to right, color-mix(in srgb, ${theme.accent} 18%, transparent), transparent 62%)`
        }}
      />

      <div className="relative flex min-w-0 items-center gap-1.5">
        <span
          className="inline-flex size-5 shrink-0 items-center justify-center rounded-md text-[9px] font-bold tracking-wide text-white"
          style={{ background: node.agent.colour }}
          title={node.agent.monogram}
        >
          {node.agent.monogram}
        </span>
        <b className="text-[9px] font-bold tracking-[0.09em] uppercase opacity-80">{theme.label}</b>
        <span className="ml-auto inline-flex shrink-0 items-center gap-1">
          {node.thread.unread ? (
            <span className="size-1.5 rounded-full bg-primary" title="Unread" />
          ) : null}
          {node.thread.agentState === 'working' ? (
            <span
              aria-hidden
              className="size-2 rounded-full border-2 border-t-transparent [animation:spin_1s_steps(12,end)_infinite] motion-reduce:animate-none"
              style={{ borderColor: theme.accent, borderTopColor: 'transparent' }}
            />
          ) : null}
        </span>
      </div>

      <div className="relative line-clamp-2 text-[11.5px] leading-tight font-medium">{title}</div>

      <div className="relative mt-auto flex min-w-0 items-center gap-1.5">
        <span className="inline-flex shrink-0">
          <AgentIcon agent={agentTypeToIconAgent(node.thread.agentType)} size={12} />
        </span>
        <span className="truncate text-[10px] opacity-70">
          {formatAgentTypeLabel(node.thread.agentType)}
          {subtitle ? ` · ${subtitle}` : ''}
        </span>
      </div>
    </button>
  )
}
