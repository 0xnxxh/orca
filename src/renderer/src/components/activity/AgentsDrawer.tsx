import React, { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { useActivityUnreadCount } from './useActivityUnreadCount'
import ActivityPrototypePage from './ActivityPrototypePage'
import { translate } from '@/i18n/i18n'

type AgentsDrawerProps = {
  leftSidebarStyle?: React.CSSProperties
  open: boolean
  statusBarVisible: boolean
  onOpenChange: (open: boolean) => void
}

const WORKSPACE_TOP_CHROME_HEIGHT = 36
const STATUS_BAR_RESERVE_HEIGHT = 24

const AGENTS_PANEL_KEEP_OPEN_SELECTOR = [
  '[data-agents-panel-trigger]',
  '[data-radix-popper-content-wrapper]',
  '[data-slot="dropdown-menu-content"]',
  '[data-slot="context-menu-content"]',
  '[data-slot="popover-content"]',
  '[data-slot="dialog-content"]',
  '[data-slot="dialog-overlay"]',
  '[data-sonner-toast]',
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
  '[role="menu"][data-state="open"]'
].join(', ')

function isAgentsPanelKeepOpenTarget(target: EventTarget | null): boolean {
  const element =
    target instanceof Element ? target : target instanceof Node ? target.parentElement : null
  return Boolean(element?.closest(AGENTS_PANEL_KEEP_OPEN_SELECTOR))
}

export default function AgentsDrawer({
  leftSidebarStyle,
  open,
  statusBarVisible,
  onOpenChange
}: AgentsDrawerProps): React.JSX.Element {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen)
  const sidebarWidth = useAppStore((s) => s.sidebarWidth)
  const unreadCount = useActivityUnreadCount(open, 'agent-events')
  const contentRef = useRef<HTMLDivElement | null>(null)

  const drawerLeftCss = sidebarOpen
    ? `var(--workspace-sidebar-live-width, ${sidebarWidth}px)`
    : '0px'
  const drawerBottom = `${statusBarVisible ? STATUS_BAR_RESERVE_HEIGHT : 0}px`

  useEffect(() => {
    if (!open) {
      return
    }

    const handlePointerDown = (event: PointerEvent): void => {
      const content = contentRef.current?.closest<HTMLElement>('[data-slot="sheet-content"]')
      if (!content) {
        return
      }
      if (event.target instanceof Node && content.contains(event.target)) {
        return
      }
      if (isAgentsPanelKeepOpenTarget(event.target)) {
        return
      }
      const rect = content.getBoundingClientRect()
      if (event.clientX > rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom) {
        onOpenChange(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => document.removeEventListener('pointerdown', handlePointerDown, true)
  }, [onOpenChange, open])

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        side="left"
        showCloseButton={false}
        className="agents-panel-sheet-content bg-background p-0 sm:max-w-none"
        // Why: keep the non-interactive scrim snappy; content uses a near-instant
        // fade via .agents-panel-sheet-content instead of the left-sheet slide.
        overlayClassName="duration-75 data-[state=open]:duration-75 data-[state=closed]:duration-75"
        overlayStyle={{
          top: WORKSPACE_TOP_CHROME_HEIGHT,
          bottom: drawerBottom,
          left: drawerLeftCss,
          pointerEvents: 'none'
        }}
        style={
          {
            ...leftSidebarStyle,
            // Why: companion panel expands from the sidebar edge (same as the
            // workspace board) instead of replacing the main navigation surface.
            left: drawerLeftCss,
            top: WORKSPACE_TOP_CHROME_HEIGHT,
            bottom: drawerBottom,
            height: 'auto',
            width: `min(calc(100vw - ${drawerLeftCss}), 1294px)`
          } as React.CSSProperties
        }
        data-agents-panel-sheet=""
        onOpenAutoFocus={(event) => {
          // Why: avoid auto-focusing the first control (and its tooltip) on open.
          event.preventDefault()
        }}
        onPointerDownOutside={(event) => {
          const originalEvent = event.detail.originalEvent
          const target = originalEvent.target
          if (isAgentsPanelKeepOpenTarget(target)) {
            event.preventDefault()
            return
          }
          const liveDrawerLeft =
            contentRef.current
              ?.closest<HTMLElement>('[data-slot="sheet-content"]')
              ?.getBoundingClientRect().left ?? (sidebarOpen ? sidebarWidth : 0)
          const pointerX =
            'clientX' in originalEvent && typeof originalEvent.clientX === 'number'
              ? originalEvent.clientX
              : null
          if (pointerX !== null && pointerX < liveDrawerLeft) {
            // Why: keep the workspace sidebar interactive while the panel stays open.
            event.preventDefault()
          }
        }}
        onInteractOutside={(event) => {
          const originalEvent = event.detail.originalEvent
          const target = originalEvent.target
          if (isAgentsPanelKeepOpenTarget(target)) {
            event.preventDefault()
            return
          }
          const liveDrawerLeft =
            contentRef.current
              ?.closest<HTMLElement>('[data-slot="sheet-content"]')
              ?.getBoundingClientRect().left ?? (sidebarOpen ? sidebarWidth : 0)
          const pointerX =
            'clientX' in originalEvent && typeof originalEvent.clientX === 'number'
              ? originalEvent.clientX
              : null
          if (pointerX !== null && pointerX < liveDrawerLeft) {
            event.preventDefault()
          }
        }}
      >
        <SheetHeader className="border-b border-border px-4 py-3 pr-14">
          <SheetTitle className="flex items-center gap-2 text-sm">
            <span>{translate('auto.components.activity.AgentsDrawer.title', 'Agents')}</span>
            {unreadCount > 0 ? (
              <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {unreadCount} {translate('auto.components.activity.AgentsDrawer.unread', 'unread')}
              </span>
            ) : null}
          </SheetTitle>
          <SheetDescription className="sr-only">
            {translate(
              'auto.components.activity.AgentsDrawer.description',
              'Browse agent sessions by status and open their terminals.'
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="absolute right-3 top-2.5 flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={translate('auto.components.activity.AgentsDrawer.close', 'Close')}
            onClick={() => onOpenChange(false)}
          >
            <X className="size-3.5" />
          </Button>
        </div>

        <div ref={contentRef} className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {open ? <ActivityPrototypePage /> : null}
        </div>
      </SheetContent>
    </Sheet>
  )
}
