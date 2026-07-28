import { Button } from '@renderer/components/ui/button'
import { FileCode2, FileText, Globe2, Loader2, TerminalSquare, X } from 'lucide-react'
import React from 'react'
import type { MobileWebSessionTab } from '../../shared/mobile-web/bridge-operation-contract'
import type { MobileWebSessionPendingAction } from './mobile-web-session-actions'

export function MobileWebSessionTabRow({
  tab,
  connected,
  pending,
  onActivate,
  onClose
}: {
  tab: MobileWebSessionTab
  connected: boolean
  pending: MobileWebSessionPendingAction
  onActivate: (tabId: string) => void
  onClose: (tabId: string) => void
}): React.JSX.Element {
  const Icon = tabIcon(tab.type)
  const activating = pending === `activate:${tab.id}`
  const closing = pending === `close:${tab.id}`
  return (
    <li
      data-current={tab.isActive}
      className="flex items-center border-b border-border last:border-b-0 data-[current=true]:bg-accent"
    >
      <Button
        variant="ghost"
        className="h-auto min-w-0 flex-1 justify-start gap-3 rounded-none px-6 py-3 text-left"
        disabled={!connected || pending !== null}
        onClick={() => onActivate(tab.id)}
      >
        {activating ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <Icon className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{tab.title}</span>
          <span className="mt-0.5 block text-xs capitalize text-muted-foreground">
            {tab.type}
            {tab.type === 'terminal' && tab.status === 'pending-handle' ? ' · Starting' : ''}
          </span>
        </span>
        {tab.isActive ? (
          <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
            Active
          </span>
        ) : null}
      </Button>
      <Button
        aria-label={`Close ${tab.title}`}
        variant="ghost"
        size="icon-sm"
        className="mr-4 shrink-0"
        disabled={!connected || pending !== null}
        onClick={() => onClose(tab.id)}
      >
        {closing ? <Loader2 className="animate-spin" /> : <X />}
      </Button>
    </li>
  )
}

function tabIcon(type: MobileWebSessionTab['type']) {
  if (type === 'terminal') {
    return TerminalSquare
  }
  if (type === 'markdown') {
    return FileText
  }
  if (type === 'file') {
    return FileCode2
  }
  return Globe2
}
