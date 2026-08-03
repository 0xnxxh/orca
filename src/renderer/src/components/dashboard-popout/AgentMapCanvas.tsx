import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from 'react'
import { translate } from '@/i18n/i18n'
import type { DashboardCard } from '../../../../shared/dashboard-snapshot'
import type {
  AgentMapAgentNode,
  AgentMapProjectRing,
  AgentMapLayout,
  AgentMapWorktreeRing
} from './agent-map-layout'
import { AgentMapScene } from './AgentMapScene'
import { AgentMapViewportControls } from './AgentMapViewportControls'
import {
  AgentMapWorkspaceContextMenuLoader,
  type AgentMapWorkspaceContextMenuRequest
} from './AgentMapWorkspaceContextMenuLoader'
import {
  agentMapAgents,
  navigableAgentMapAgents,
  nextDirectionalAgent
} from './agent-map-navigation'

const MIN_ZOOM = 0.7
const MAX_ZOOM = 4

type Point = { x: number; y: number }
type ViewportSize = { width: number; height: number }
type Viewport = { center: Point; zoom: number }

export type AgentMapCanvasHandle = {
  fit: () => void
  focusProject: (project: AgentMapProjectRing) => void
}

type AgentMapCanvasProps = {
  layout: AgentMapLayout
  selectedPaneKey: string | null
  allowAggregation: boolean
  workspaceContextMenusEnabled?: boolean
  onWorkspaceContextMenuOpenChange?: (open: boolean) => void
  onSelectAgent: (card: DashboardCard, side: 'left' | 'right') => void
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

export const AgentMapCanvas = forwardRef<AgentMapCanvasHandle, AgentMapCanvasProps>(
  function AgentMapCanvas(
    {
      layout,
      selectedPaneKey,
      allowAggregation,
      workspaceContextMenusEnabled = false,
      onWorkspaceContextMenuOpenChange,
      onSelectAgent
    },
    forwardedRef
  ): React.JSX.Element {
    const containerRef = useRef<HTMLDivElement>(null)
    const svgRef = useRef<SVGSVGElement>(null)
    const nodeRefs = useRef(new Map<string, SVGGElement>())
    const dragRef = useRef<{
      pointerId: number
      point: Point
      center: Point
      worldPerPixelX: number
      worldPerPixelY: number
    } | null>(null)
    const viewportFrameRef = useRef<number | null>(null)
    const pendingViewportRef = useRef<Viewport | null>(null)
    const interactionBoundsRef = useRef<DOMRect | null>(null)
    const focusedAgentRef = useRef<{ paneKey: string; x: number; y: number } | null>(null)
    const contextMenuRequestIdRef = useRef(0)
    const [size, setSize] = useState<ViewportSize>({ width: 800, height: 560 })
    const [viewport, setViewport] = useState<Viewport>({
      center: { x: layout.width / 2, y: layout.height / 2 },
      zoom: 1
    })
    const [contextMenuRequest, setContextMenuRequest] =
      useState<AgentMapWorkspaceContextMenuRequest | null>(null)
    const viewportRef = useRef(viewport)
    const { center, zoom } = viewport
    const agents = useMemo(() => agentMapAgents(layout), [layout])
    const navigableAgents = useMemo(
      () => navigableAgentMapAgents(layout, zoom, allowAggregation, selectedPaneKey),
      [allowAggregation, layout, selectedPaneKey, zoom]
    )
    const aspect = size.width / Math.max(1, size.height)
    const baseWidth = Math.max(layout.width, layout.height * aspect)
    const baseHeight = baseWidth / aspect
    const viewWidth = baseWidth / zoom
    const viewHeight = baseHeight / zoom
    const mapScale = size.width / viewWidth
    const labelScale = Math.max(1, 1 / mapScale)
    const viewBox = `${center.x - viewWidth / 2} ${center.y - viewHeight / 2} ${viewWidth} ${viewHeight}`

    const applyViewport = useCallback((next: Viewport): void => {
      viewportRef.current = next
      pendingViewportRef.current = null
      interactionBoundsRef.current = null
      setViewport(next)
    }, [])
    const scheduleViewport = useCallback((next: Viewport): void => {
      viewportRef.current = next
      pendingViewportRef.current = next
      if (viewportFrameRef.current !== null) {
        return
      }
      viewportFrameRef.current = requestAnimationFrame(() => {
        viewportFrameRef.current = null
        interactionBoundsRef.current = null
        const pending = pendingViewportRef.current
        pendingViewportRef.current = null
        if (pending) {
          setViewport(pending)
        }
      })
    }, [])
    const fit = useCallback((): void => {
      applyViewport({ center: { x: layout.width / 2, y: layout.height / 2 }, zoom: 1 })
    }, [applyViewport, layout.height, layout.width])
    const focusProject = useCallback(
      (project: AgentMapProjectRing): void => {
        const projectWidth = project.radius * 2.5
        const projectHeight = project.radius * 2.5
        applyViewport({
          center: { x: project.x, y: project.y },
          zoom: clamp(
            Math.min(baseWidth / projectWidth, baseHeight / projectHeight),
            MIN_ZOOM,
            MAX_ZOOM
          )
        })
      },
      [applyViewport, baseHeight, baseWidth]
    )
    useImperativeHandle(forwardedRef, () => ({ fit, focusProject }), [fit, focusProject])

    useEffect(() => {
      const container = containerRef.current
      if (!container || typeof ResizeObserver === 'undefined') {
        return
      }
      const measure = (): void => {
        const next = container.getBoundingClientRect()
        if (next.width > 0 && next.height > 0) {
          interactionBoundsRef.current = null
          setSize((current) =>
            current.width === next.width && current.height === next.height
              ? current
              : { width: next.width, height: next.height }
          )
        }
      }
      measure()
      const observer = new ResizeObserver(measure)
      observer.observe(container)
      return () => observer.disconnect()
    }, [])

    useEffect(
      () => () => {
        if (viewportFrameRef.current !== null) {
          cancelAnimationFrame(viewportFrameRef.current)
        }
      },
      []
    )

    useEffect(() => {
      if (!selectedPaneKey) {
        focusedAgentRef.current = null
        return
      }
      const selected = agents.find((agent) => agent.card.paneKey === selectedPaneKey)
      if (!selected) {
        focusedAgentRef.current = null
        return
      }
      const focused = focusedAgentRef.current
      if (
        focused?.paneKey === selectedPaneKey &&
        focused.x === selected.x &&
        focused.y === selected.y
      ) {
        return
      }
      focusedAgentRef.current = { paneKey: selectedPaneKey, x: selected.x, y: selected.y }
      applyViewport({
        center: { x: selected.x, y: selected.y },
        zoom: Math.max(1, viewportRef.current.zoom)
      })
    }, [agents, applyViewport, selectedPaneKey])

    const handleAgentKeyDown = useCallback(
      (event: React.KeyboardEvent<SVGGElement>, agent: AgentMapAgentNode): void => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          const bounds = event.currentTarget.getBoundingClientRect()
          const side = bounds.left + bounds.width / 2 <= window.innerWidth / 2 ? 'right' : 'left'
          onSelectAgent(agent.card, side)
          return
        }
        const direction =
          event.key === 'ArrowLeft'
            ? { x: -1, y: 0 }
            : event.key === 'ArrowRight'
              ? { x: 1, y: 0 }
              : event.key === 'ArrowUp'
                ? { x: 0, y: -1 }
                : event.key === 'ArrowDown'
                  ? { x: 0, y: 1 }
                  : null
        if (!direction) {
          return
        }
        event.preventDefault()
        const next = nextDirectionalAgent(agent, navigableAgents, direction)
        nodeRefs.current.get(next?.card.paneKey ?? '')?.focus()
      },
      [navigableAgents, onSelectAgent]
    )

    const handleOpenWorkspaceContextMenu = useCallback(
      (event: React.MouseEvent<SVGCircleElement>, worktree: AgentMapWorktreeRing): void => {
        contextMenuRequestIdRef.current += 1
        setContextMenuRequest({
          id: contextMenuRequestIdRef.current,
          worktreeId: worktree.worktreeId,
          executionHostId: worktree.executionHostId,
          clientX: event.clientX,
          clientY: event.clientY,
          altKey: event.altKey
        })
      },
      []
    )

    const zoomAt = useCallback(
      (nextZoom: number, clientX?: number, clientY?: number): void => {
        const clampedZoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM)
        if (clientX === undefined || clientY === undefined) {
          applyViewport({ ...viewportRef.current, zoom: clampedZoom })
          return
        }
        const bounds =
          interactionBoundsRef.current ?? svgRef.current?.getBoundingClientRect() ?? null
        if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
          applyViewport({ ...viewportRef.current, zoom: clampedZoom })
          return
        }
        interactionBoundsRef.current = bounds
        const current = viewportRef.current
        const currentWidth = baseWidth / current.zoom
        const currentHeight = baseHeight / current.zoom
        const anchorX =
          current.center.x -
          currentWidth / 2 +
          ((clientX - bounds.left) / bounds.width) * currentWidth
        const anchorY =
          current.center.y -
          currentHeight / 2 +
          ((clientY - bounds.top) / bounds.height) * currentHeight
        const nextWidth = baseWidth / clampedZoom
        const nextHeight = baseHeight / clampedZoom
        const xRatio = (clientX - bounds.left) / bounds.width
        const yRatio = (clientY - bounds.top) / bounds.height
        scheduleViewport({
          center: {
            x: anchorX - (xRatio - 0.5) * nextWidth,
            y: anchorY - (yRatio - 0.5) * nextHeight
          },
          zoom: clampedZoom
        })
      },
      [applyViewport, baseHeight, baseWidth, scheduleViewport]
    )

    return (
      <div ref={containerRef} className="agent-map-canvas relative min-h-0 flex-1 overflow-hidden">
        {layout.projects.length === 0 ? (
          <div className="absolute inset-0 grid place-items-center text-center text-xs text-muted-foreground">
            {translate('dashboardPopout.map.empty', 'No agents match the current filters.')}
          </div>
        ) : (
          <svg
            ref={svgRef}
            className="absolute inset-0 size-full touch-none"
            viewBox={viewBox}
            aria-label={translate(
              'dashboardPopout.map.canvasLabel',
              'Nested project, workspace, and agent map'
            )}
            onWheel={(event) => {
              event.preventDefault()
              zoomAt(
                viewportRef.current.zoom * Math.exp(-event.deltaY * 0.0015),
                event.clientX,
                event.clientY
              )
            }}
            onPointerDown={(event) => {
              if (
                (event.target as Element).closest(
                  '[data-agent-map-agent], .agent-map-worktree-ring'
                )
              ) {
                return
              }
              const bounds = event.currentTarget.getBoundingClientRect()
              if (bounds.width <= 0 || bounds.height <= 0) {
                return
              }
              const current = viewportRef.current
              dragRef.current = {
                pointerId: event.pointerId,
                point: { x: event.clientX, y: event.clientY },
                center: current.center,
                worldPerPixelX: baseWidth / current.zoom / bounds.width,
                worldPerPixelY: baseHeight / current.zoom / bounds.height
              }
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onPointerMove={(event) => {
              const drag = dragRef.current
              if (!drag || drag.pointerId !== event.pointerId) {
                return
              }
              scheduleViewport({
                center: {
                  x: drag.center.x - (event.clientX - drag.point.x) * drag.worldPerPixelX,
                  y: drag.center.y - (event.clientY - drag.point.y) * drag.worldPerPixelY
                },
                zoom: viewportRef.current.zoom
              })
            }}
            onPointerUp={(event) => {
              if (dragRef.current?.pointerId === event.pointerId) {
                dragRef.current = null
                event.currentTarget.releasePointerCapture(event.pointerId)
              }
            }}
            onPointerCancel={(event) => {
              if (dragRef.current?.pointerId === event.pointerId) {
                dragRef.current = null
              }
            }}
          >
            <AgentMapScene
              layout={layout}
              zoom={zoom}
              labelScale={labelScale}
              mapScale={mapScale}
              selectedPaneKey={selectedPaneKey}
              allowAggregation={allowAggregation}
              nodeRefs={nodeRefs}
              onSelectAgent={onSelectAgent}
              onOpenWorkspaceContextMenu={
                workspaceContextMenusEnabled ? handleOpenWorkspaceContextMenu : undefined
              }
              onAgentKeyDown={handleAgentKeyDown}
            />
          </svg>
        )}

        <AgentMapViewportControls
          zoom={zoom}
          onFit={fit}
          onZoomIn={() => zoomAt(viewportRef.current.zoom * 1.25)}
          onZoomOut={() => zoomAt(viewportRef.current.zoom / 1.25)}
        />
        {workspaceContextMenusEnabled && contextMenuRequest ? (
          <AgentMapWorkspaceContextMenuLoader
            request={contextMenuRequest}
            onOpenChange={onWorkspaceContextMenuOpenChange}
          />
        ) : null}
      </div>
    )
  }
)
