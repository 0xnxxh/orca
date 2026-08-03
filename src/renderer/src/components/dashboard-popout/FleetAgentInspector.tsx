import { useState } from 'react'
import { Send, SquareArrowOutUpRight } from 'lucide-react'
import { AgentStateDot, agentStateLabel } from '@/components/AgentStateDot'
import { ShortcutKeyCombo } from '@/components/ShortcutKeyCombo'
import { Button } from '@/components/ui/button'
import { formatAgentTypeLabel } from '@/lib/agent-status'
import { translate } from '@/i18n/i18n'
import {
  buildNativeChatPasteBytes,
  NATIVE_CHAT_SUBMIT
} from '@/components/native-chat/native-chat-send'
import type { DashboardCard } from '../../../../shared/dashboard-snapshot'
import type { AgentMapWorktreeRing } from './agent-map-layout'

type FleetAgentInspectorProps = {
  card: DashboardCard | null
  worktree: AgentMapWorktreeRing | null
  draft: string
  onDraftChange: (value: string) => void
  onOpenTerminal: (card: DashboardCard) => void
}

function compactDuration(card: DashboardCard, now: number): string {
  if (card.startedAt <= 0) {
    return translate('dashboardPopout.map.durationUnknown', 'Duration unavailable')
  }
  const end = card.finishedAt ?? now
  const minutes = Math.max(0, Math.floor((end - card.startedAt) / 60_000))
  if (minutes < 60) {
    return translate('dashboardPopout.map.durationMinutes', '{{count}}m active', {
      count: minutes
    })
  }
  return translate('dashboardPopout.map.durationHours', '{{count}}h active', {
    count: Math.floor(minutes / 60)
  })
}

export function FleetAgentInspector({
  card,
  worktree,
  draft,
  onDraftChange,
  onOpenTerminal
}: FleetAgentInspectorProps): React.JSX.Element {
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState(false)
  const isMac = navigator.userAgent.includes('Mac')

  if (!card || !worktree) {
    return (
      <aside className="hidden min-h-0 w-64 shrink-0 border-l border-border bg-card/35 p-4 md:block">
        <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
          {translate('dashboardPopout.map.selectedAgent', 'Selected agent')}
        </span>
        <p className="mt-2 text-xs text-muted-foreground">
          {translate(
            'dashboardPopout.map.selectAgentHint',
            'Select an agent node to pin its details and response draft.'
          )}
        </p>
      </aside>
    )
  }

  const sendDraft = async (): Promise<void> => {
    const message = draft.trim()
    if (!card.ptyId || !message || sending) {
      return
    }
    setSending(true)
    setSendError(false)
    try {
      const bodySent = await window.api.terminalPreview.input(
        card.ptyId,
        buildNativeChatPasteBytes(message)
      )
      const submitted =
        bodySent && (await window.api.terminalPreview.input(card.ptyId, NATIVE_CHAT_SUBMIT))
      if (submitted) {
        onDraftChange('')
      } else {
        setSendError(true)
      }
    } catch {
      setSendError(true)
    } finally {
      setSending(false)
    }
  }
  const statusCounts = worktree.statusCounts

  return (
    <aside className="scrollbar-sleek hidden min-h-0 w-64 shrink-0 overflow-y-auto border-l border-border bg-card/35 p-4 md:flex md:flex-col">
      <header>
        <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
          {translate('dashboardPopout.map.selectedAgent', 'Selected agent')}
        </span>
        <h2 className="mt-1 truncate text-sm font-semibold">
          {card.conversationName ?? formatAgentTypeLabel(card.agentType)}
        </h2>
        <p className="truncate text-[11px] text-muted-foreground">{card.worktreeName}</p>
      </header>

      <div className="mt-3 grid grid-cols-3 gap-1.5">
        <span className="rounded-md bg-muted p-2 text-[10px] text-muted-foreground">
          <strong className="block text-sm text-foreground">
            {statusCounts.blocked + statusCounts.waiting}
          </strong>
          {translate('dashboardPopout.bucket.attention', 'Needs You')}
        </span>
        <span className="rounded-md bg-muted p-2 text-[10px] text-muted-foreground">
          <strong className="block text-sm text-foreground">{statusCounts.working}</strong>
          {translate('dashboardPopout.bucket.working', 'Working')}
        </span>
        <span className="rounded-md bg-muted p-2 text-[10px] text-muted-foreground">
          <strong className="block text-sm text-foreground">{worktree.agents.length}</strong>
          {translate('dashboardPopout.map.inRing', 'In ring')}
        </span>
      </div>

      <section className="mt-4 border-t border-border pt-4">
        <div className="flex items-center gap-2">
          <AgentStateDot state={card.dotState} size="md" />
          <span className="min-w-0">
            <strong className="block text-xs">{agentStateLabel(card.dotState)}</strong>
            <span className="block text-[11px] text-muted-foreground">
              {compactDuration(card, Date.now())}
            </span>
          </span>
        </div>
        {card.task || card.lastAgentMessage ? (
          <p className="mt-3 line-clamp-5 text-xs leading-relaxed text-muted-foreground">
            {card.lastAgentMessage || card.task}
          </p>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="mt-3 w-full"
          onClick={() => onOpenTerminal(card)}
        >
          <SquareArrowOutUpRight className="size-3" />
          {translate('dashboardPopout.map.openLiveTerminal', 'Open live terminal')}
        </Button>
      </section>

      <section className="mt-auto pt-4">
        <div className="overflow-hidden rounded-lg border border-border bg-card shadow-xs">
          <label
            htmlFor={`fleet-response-${card.paneKey}`}
            className="block border-b border-border px-2.5 py-2 text-[11px] font-semibold"
          >
            {translate('dashboardPopout.map.respondToAgent', 'Respond to agent')}
          </label>
          <textarea
            id={`fleet-response-${card.paneKey}`}
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={(event) => {
              const modifier = isMac ? event.metaKey : event.ctrlKey
              if (event.key === 'Enter' && modifier) {
                event.preventDefault()
                void sendDraft()
              }
            }}
            placeholder={translate('dashboardPopout.map.responsePlaceholder', 'Send direction…')}
            className="scrollbar-sleek min-h-24 w-full resize-none bg-transparent px-2.5 py-2 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          />
          <footer className="flex items-center gap-2 border-t border-border px-2 py-1.5">
            {sendError ? (
              <span className="text-[10px] text-destructive">
                {translate('dashboardPopout.map.sendFailed', 'Send failed')}
              </span>
            ) : (
              <span className="text-[10px] text-muted-foreground">
                {card.ptyId
                  ? translate('dashboardPopout.map.routesToTerminal', 'Routes to live terminal')
                  : translate('dashboardPopout.map.terminalUnavailable', 'Terminal unavailable')}
              </span>
            )}
            <Button
              type="button"
              size="xs"
              className="ml-auto"
              disabled={!card.ptyId || !draft.trim() || sending}
              onClick={() => void sendDraft()}
            >
              <Send className="size-3" />
              {sending
                ? translate('dashboardPopout.map.sending', 'Sending…')
                : translate('dashboardPopout.map.send', 'Send')}
              <ShortcutKeyCombo
                keys={[isMac ? '⌘' : 'Ctrl', '↵']}
                keyCapClassName="min-w-4 border-primary-foreground/20 bg-primary-foreground/10 px-1 py-0 text-[9px] text-primary-foreground shadow-none"
                separatorClassName="text-primary-foreground/70"
              />
            </Button>
          </footer>
        </div>
      </section>
    </aside>
  )
}
