import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Expand, LocateFixed, Minus, Network, Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'

import { ACTIVITY_CANVAS_STATUS_SURFACE, ActivityCanvasNodeCard } from './ActivityCanvasNodeCard'
import { buildDemoCanvasThreads } from './activity-canvas-demo-threads'
import {
  type ActivityCanvasAgentState,
  type ActivityCanvasLayout,
  type ActivityCanvasThreadInput,
  layoutActivityCanvas
} from './activity-canvas-layout'

export type { ActivityViewMode } from './ActivityCanvasNodeCard'
export { ActivityViewModeToggle } from './ActivityCanvasNodeCard'

const MIN_ZOOM = 0.35
const MAX_ZOOM = 1.75
const ZOOM_STEP = 0.12

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

export function ActivityAgentsCanvas({
  threads,
  selectedPaneKey,
  onSelectPaneKey,
  className
}: {
  threads: ActivityCanvasThreadInput[]
  selectedPaneKey: string | null
  onSelectPaneKey: (paneKey: string | null) => void
  className?: string
}): React.JSX.Element {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [zoom, setZoom] = useState(0.9)
  const [pan, setPan] = useState({ x: 24, y: 24 })
  // Demo nodes are not real panes; keep selection local so the sample graph
  // still shows a selected ring without mutating Activity thread state.
  const [demoSelectedPaneKey, setDemoSelectedPaneKey] = useState<string | null>(null)
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
    moved: boolean
  } | null>(null)

  const usingDemo = threads.length === 0
  const layoutThreads = useMemo(
    () => (usingDemo ? buildDemoCanvasThreads() : threads),
    [threads, usingDemo]
  )
  const layout: ActivityCanvasLayout = useMemo(
    () => layoutActivityCanvas(layoutThreads),
    [layoutThreads]
  )
  const effectiveSelectedPaneKey = usingDemo ? demoSelectedPaneKey : selectedPaneKey

  const fitView = useCallback(() => {
    const el = viewportRef.current
    if (!el) {
      return
    }
    const pad = 48
    const vw = el.clientWidth
    const vh = el.clientHeight
    if (vw <= 0 || vh <= 0) {
      return
    }
    const scale = clamp(
      Math.min((vw - pad * 2) / layout.width, (vh - pad * 2) / layout.height),
      MIN_ZOOM,
      1
    )
    setZoom(scale)
    setPan({
      x: (vw - layout.width * scale) / 2,
      y: Math.max(16, (vh - layout.height * scale) / 2)
    })
  }, [layout.height, layout.width])

  useEffect(() => {
    fitView()
  }, [fitView, layout.nodes.length])

  const onWheel = (event: React.WheelEvent<HTMLDivElement>): void => {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault()
      const delta = event.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP
      setZoom((z) => clamp(z + delta, MIN_ZOOM, MAX_ZOOM))
      return
    }
    setPan((p) => ({ x: p.x - event.deltaX, y: p.y - event.deltaY }))
  }

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) {
      return
    }
    // Only start pan from the empty field, not from a node.
    if ((event.target as HTMLElement).closest('[data-testid="activity-canvas-node"]')) {
      return
    }
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: pan.x,
      originY: pan.y,
      moved: false
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) {
      return
    }
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (Math.abs(dx) + Math.abs(dy) > 3) {
      drag.moved = true
    }
    setPan({ x: drag.originX + dx, y: drag.originY + dy })
  }

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) {
      return
    }
    dragRef.current = null
    if (!drag.moved) {
      if (usingDemo) {
        setDemoSelectedPaneKey(null)
      } else {
        onSelectPaneKey(null)
      }
    }
  }

  const statusLegend = useMemo(() => {
    const counts = new Map<ActivityCanvasAgentState, number>()
    for (const node of layout.nodes) {
      counts.set(node.thread.agentState, (counts.get(node.thread.agentState) ?? 0) + 1)
    }
    return (Object.keys(ACTIVITY_CANVAS_STATUS_SURFACE) as ActivityCanvasAgentState[])
      .filter((state) => (counts.get(state) ?? 0) > 0)
      .map((state) => ({
        state,
        count: counts.get(state) ?? 0,
        ...ACTIVITY_CANVAS_STATUS_SURFACE[state]
      }))
  }, [layout.nodes])

  return (
    <div
      className={cn('relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden', className)}
      data-testid="activity-agents-canvas"
    >
      <div
        ref={viewportRef}
        className={cn(
          'relative min-h-0 flex-1 cursor-grab overflow-hidden bg-background active:cursor-grabbing',
          // Dot field — orca-viz canvas texture without inventing new tokens.
          '[background-image:radial-gradient(circle,color-mix(in_srgb,var(--border)_80%,transparent)_1px,transparent_1px)]',
          '[background-size:18px_18px]'
        )}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          className="absolute origin-top-left will-change-transform"
          style={{
            width: layout.width,
            height: layout.height,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`
          }}
        >
          {layout.clusters.map((cluster) => (
            <div
              key={cluster.id}
              className="pointer-events-none absolute rounded-2xl border border-dashed border-border/80 bg-muted/20"
              style={{
                left: cluster.x,
                top: cluster.y,
                width: cluster.width,
                height: cluster.height
              }}
            >
              <div className="absolute -top-2.5 left-3 rounded-full border border-border bg-background/90 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase backdrop-blur">
                {cluster.label}
              </div>
            </div>
          ))}

          <svg
            className="pointer-events-none absolute inset-0 overflow-visible"
            width={layout.width}
            height={layout.height}
            aria-hidden
          >
            <defs>
              <marker
                id="activity-canvas-arrow"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" className="fill-muted-foreground/70" />
              </marker>
            </defs>
            {layout.edges.map((edge) => (
              <path
                key={edge.id}
                d={edge.path}
                fill="none"
                className="stroke-muted-foreground/55"
                strokeWidth={1.5}
                markerEnd="url(#activity-canvas-arrow)"
              />
            ))}
          </svg>

          {layout.nodes.map((node) => (
            <ActivityCanvasNodeCard
              key={node.id}
              node={node}
              selected={effectiveSelectedPaneKey === node.thread.paneKey}
              onSelect={() => {
                if (usingDemo) {
                  setDemoSelectedPaneKey(node.thread.paneKey)
                  return
                }
                onSelectPaneKey(node.thread.paneKey)
              }}
            />
          ))}
        </div>

        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
          <div className="pointer-events-auto max-w-[min(420px,70%)] rounded-xl border border-border bg-background/90 px-3 py-2 text-xs shadow-sm backdrop-blur">
            <div className="flex items-center gap-1.5 font-semibold text-foreground">
              <Network className="size-3.5 text-muted-foreground" />
              {usingDemo
                ? translate(
                    'auto.components.activity.ActivityAgentsCanvas.demoTitle',
                    'Canvas preview (sample data)'
                  )
                : translate(
                    'auto.components.activity.ActivityAgentsCanvas.liveTitle',
                    'Agents canvas'
                  )}
            </div>
            <div className="mt-0.5 text-muted-foreground">
              {usingDemo
                ? translate(
                    'auto.components.activity.ActivityAgentsCanvas.demoHint',
                    'No live agents match filters — showing a sample orchestration graph. Start agents to replace this with real data.'
                  )
                : translate(
                    'auto.components.activity.ActivityAgentsCanvas.liveHint',
                    '{{linked}} linked · {{isolated}} isolated · fill = status · stripe = agent',
                    {
                      linked: layout.linkedCount,
                      isolated: layout.isolatedCount
                    }
                  )}
            </div>
            {statusLegend.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {statusLegend.map((item) => (
                  <span key={item.state} className="inline-flex items-center gap-1.5 text-[10px]">
                    <span
                      className="size-2 rounded-sm"
                      style={{ background: item.accent }}
                      aria-hidden
                    />
                    <span className="text-muted-foreground">
                      {item.label.toLowerCase()} ({item.count})
                    </span>
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-border bg-background/90 p-1 shadow-sm backdrop-blur">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Zoom out"
                  onClick={() => setZoom((z) => clamp(z - ZOOM_STEP, MIN_ZOOM, MAX_ZOOM))}
                >
                  <Minus className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Zoom out</TooltipContent>
            </Tooltip>
            <span className="min-w-[3rem] text-center text-[10px] tabular-nums text-muted-foreground">
              {Math.round(zoom * 100)}%
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Zoom in"
                  onClick={() => setZoom((z) => clamp(z + ZOOM_STEP, MIN_ZOOM, MAX_ZOOM))}
                >
                  <Plus className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Zoom in</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Fit view"
                  onClick={fitView}
                >
                  <Expand className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Fit view</TooltipContent>
            </Tooltip>
            {effectiveSelectedPaneKey ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Clear selection"
                    onClick={() => {
                      if (usingDemo) {
                        setDemoSelectedPaneKey(null)
                      } else {
                        onSelectPaneKey(null)
                      }
                    }}
                  >
                    <LocateFixed className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Clear selection</TooltipContent>
              </Tooltip>
            ) : null}
          </div>
        </div>

        {layout.nodes.length === 0 ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            {translate(
              'auto.components.activity.ActivityAgentsCanvas.empty',
              'No agent activity to place on the canvas.'
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}
