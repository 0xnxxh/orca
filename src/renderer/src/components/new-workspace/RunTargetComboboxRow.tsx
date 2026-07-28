import React from 'react'
import { AlertTriangle, ChevronRight, LoaderCircle, Monitor, Server } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { LOCAL_EXECUTION_HOST_ID, type ExecutionHostId } from '../../../../shared/execution-host'
import { ProjectOptionDetail } from './ProjectComboboxRow'
import { translate } from '@/i18n/i18n'

/** The local machine isn't a server — a monitor glyph reads as "this computer". */
export function HostRowIcon({ hostId }: { hostId: ExecutionHostId }): React.JSX.Element {
  const Icon = hostId === LOCAL_EXECUTION_HOST_ID ? Monitor : Server
  return <Icon className="size-3.5 shrink-0 text-muted-foreground" />
}

/**
 * One run-target row. Shares the Project picker's shape — 32px, baseline-aligned
 * name over a right-aligned detail, ↵ cap on the armed row — so the two fields
 * in the same form read as one control.
 */
export function RunTargetRow({
  icon,
  label,
  detail,
  armed,
  current,
  optionId,
  dimmed = false,
  submenu = false,
  onArm,
  onCommit,
  trailing
}: {
  icon: React.ReactNode
  label: string
  detail: string
  armed: boolean
  current: boolean
  optionId: string | undefined
  /** Not-ready hosts are dormant, not errors — quiet them without disabling. */
  dimmed?: boolean
  /** Opens a nested list, so it gets a chevron instead of an Enter cap. */
  submenu?: boolean
  onArm: () => void
  onCommit: () => void
  trailing?: React.ReactNode
}): React.JSX.Element {
  return (
    <div
      role="option"
      id={optionId}
      aria-selected={armed}
      aria-haspopup={submenu ? 'menu' : undefined}
      aria-expanded={submenu ? armed : undefined}
      data-armed={armed || undefined}
      data-current={current ? 'true' : undefined}
      onMouseDown={(event) => event.preventDefault()}
      onMouseMove={onArm}
      onClick={onCommit}
      className={cn(
        'flex h-8 cursor-default items-baseline gap-2 rounded-sm px-2 text-sm',
        armed && 'bg-accent text-accent-foreground',
        current && !armed && 'bg-accent/60'
      )}
    >
      {/* Icons are glyphs, not text, so they centre on the row. */}
      <span className={cn('flex h-8 shrink-0 items-center', dimmed && 'opacity-60')}>{icon}</span>
      <span
        className={cn(
          'max-w-[50%] shrink truncate',
          current && 'font-medium',
          dimmed && 'opacity-60'
        )}
      >
        {label}
      </span>
      <ProjectOptionDetail
        detail={detail}
        className={cn(
          'ml-auto min-w-0 flex-1 shrink-[999] justify-end pl-2 text-right text-xs text-muted-foreground',
          dimmed && 'opacity-60'
        )}
      />
      {trailing}
      {submenu ? (
        <span className="flex h-8 shrink-0 items-center pl-1.5">
          <ChevronRight className="size-3.5 text-muted-foreground" />
        </span>
      ) : null}
    </div>
  )
}

/** Glyph for a host that can't run yet: connecting, broken, or merely dormant. */
export function NeedsSetupHostIcon({
  hostId,
  connecting,
  attention
}: {
  hostId: ExecutionHostId
  connecting: boolean
  attention: boolean
}): React.JSX.Element {
  if (connecting) {
    return <LoaderCircle className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
  }
  if (attention) {
    return <AlertTriangle className="size-3.5 shrink-0 text-muted-foreground" />
  }
  return <HostRowIcon hostId={hostId} />
}

/** Inline Connect action on a disconnected host row. */
export function ConnectHostButton({
  connecting,
  onConnect
}: {
  connecting: boolean
  onConnect: () => void
}): React.JSX.Element {
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      // Why: only the row being connected is disabled, so one slow connect
      // can't lock out connecting to the others.
      disabled={connecting}
      className="ml-1 shrink-0 gap-1 self-center text-muted-foreground/70 hover:text-foreground"
      onMouseDown={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        // Why: keep the picker open so the connecting state stays visible; the
        // row updates in place once store SSH state resolves.
        onConnect()
      }}
    >
      {connecting ? (
        <>
          <LoaderCircle className="size-3 animate-spin" />
          {translate('auto.components.NewWorkspaceComposerCard.connectingHost', 'Connecting…')}
        </>
      ) : (
        translate('auto.components.NewWorkspaceComposerCard.connectHost', 'Connect')
      )}
    </Button>
  )
}
