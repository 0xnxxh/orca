import { useId, useState } from 'react'
import { SquareTerminal, XIcon } from 'lucide-react'
import { AgentStateDot } from '@/components/AgentStateDot'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeChatMessageList } from '@/components/native-chat/NativeChatMessageList'
import { NativeChatEmptyState } from '@/components/native-chat/NativeChatEmptyState'
import {
  buildNativeChatPasteBytes,
  NATIVE_CHAT_CLEAR_UNSUBMITTED_INPUT,
  NATIVE_CHAT_SUBMIT
} from '@/components/native-chat/native-chat-send'
import { useNativeChatLiveSession } from '@/components/native-chat/use-native-chat-live-session'
import { selectNativeChatViewState } from '@/components/native-chat/native-chat-view-state'
import { NATIVE_CHAT_SUBMIT_DELAY_MS } from '../../../../shared/native-chat-answer-stepping'
import { translate } from '@/i18n/i18n'
import { formatAgentTypeLabel } from '@/lib/agent-status'
import { cn } from '@/lib/utils'
import type { DashboardCard } from '../../../../shared/dashboard-snapshot'
import { resolveAgentChatPanelMode, type AgentChatPanelMode } from './agent-chat-panel-mode'

type AgentChatPanelProps = {
  card: DashboardCard
  onClose: () => void
  onOpenTerminal?: () => void
  className?: string
}

function agentName(card: DashboardCard): string {
  return card.conversationName ?? (card.task.trim() || formatAgentTypeLabel(card.agentType))
}

function AgentChatTranscript({
  card,
  sessionId,
  transcriptPath
}: {
  card: DashboardCard
  sessionId: string
  transcriptPath: string | null
}): React.JSX.Element {
  const session = useNativeChatLiveSession({
    paneKey: card.paneKey,
    agent: card.agentType,
    sessionId,
    transcriptPath,
    runtimeEnvironmentId: null
  })
  const viewState = selectNativeChatViewState(session)
  if (viewState.kind === 'loading') {
    return <NativeChatEmptyState kind="loading" />
  }
  if (viewState.kind === 'error') {
    return <NativeChatEmptyState kind="error" message={viewState.message} />
  }
  if (session.messages.length === 0) {
    return (
      <p className="grid flex-1 place-items-center px-4 text-center text-xs text-muted-foreground">
        {translate('dashboardPopout.chat.empty', 'No messages in this transcript yet.')}
      </p>
    )
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col px-3">
      <NativeChatMessageList
        session={session}
        isWorking={card.bucket === 'working'}
        expandSignal={false}
        fontScale={1}
      />
    </div>
  )
}

function AgentChatFallback({
  card,
  reason
}: {
  card: DashboardCard
  reason: 'no-session' | 'remote-host'
}): React.JSX.Element {
  return (
    <div className="scrollbar-sleek flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
      <p className="text-xs text-muted-foreground">
        {reason === 'remote-host'
          ? translate(
              'dashboardPopout.chat.remoteHost',
              "This agent's transcript is on another host, so it is not readable here."
            )
          : translate(
              'dashboardPopout.chat.noSession',
              'This agent has not reported a session yet, so there is no transcript to read.'
            )}
      </p>
      {card.askSummary ? (
        <section className="rounded-lg border border-border bg-muted/40 p-3">
          <h3 className="mb-1 text-[11px] font-semibold text-muted-foreground">
            {translate('dashboardPopout.chat.pendingQuestion', 'Pending question')}
          </h3>
          <p className="text-xs whitespace-pre-wrap">{card.askSummary}</p>
        </section>
      ) : null}
      {card.lastAgentMessage ? (
        <section className="rounded-lg border border-border p-3">
          <h3 className="mb-1 text-[11px] font-semibold text-muted-foreground">
            {translate('dashboardPopout.chat.lastMessage', 'Last message')}
          </h3>
          <p className="text-xs whitespace-pre-wrap">{card.lastAgentMessage}</p>
        </section>
      ) : null}
    </div>
  )
}

function AgentChatComposer({ card }: { card: DashboardCard }): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [failedSend, setFailedSend] = useState<{
    kind: 'body' | 'submit'
    ptyId: string
  } | null>(null)
  const ptyId = card.ptyId

  if (ptyId === null) {
    return (
      <p className="shrink-0 border-t border-border px-4 py-3 text-[11px] text-muted-foreground">
        {translate(
          'dashboardPopout.chat.noPane',
          'No live pane, so a reply cannot reach this agent.'
        )}
      </p>
    )
  }
  const failure = failedSend?.ptyId === ptyId ? failedSend.kind : null

  const send = async (): Promise<void> => {
    const message = draft.trim()
    if (!message || sending) {
      return
    }
    setSending(true)
    setFailedSend(null)
    let bodyAccepted = false
    try {
      const cleared = await window.api.terminalPreview.input(
        ptyId,
        NATIVE_CHAT_CLEAR_UNSUBMITTED_INPUT
      )
      if (!cleared) {
        setFailedSend({ kind: 'body', ptyId })
        return
      }
      const bodySent = await window.api.terminalPreview.input(
        ptyId,
        buildNativeChatPasteBytes(message)
      )
      if (!bodySent) {
        setFailedSend({ kind: 'body', ptyId })
        return
      }
      bodyAccepted = true
      // The accepted body is now in the TUI. Keep it out of retries even if Enter fails.
      setDraft('')
      await new Promise((resolve) => setTimeout(resolve, NATIVE_CHAT_SUBMIT_DELAY_MS))
      const submitted = await window.api.terminalPreview.input(ptyId, NATIVE_CHAT_SUBMIT)
      if (!submitted) {
        setFailedSend({ kind: 'submit', ptyId })
      }
    } catch {
      setFailedSend({ kind: bodyAccepted ? 'submit' : 'body', ptyId })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="shrink-0 border-t border-border px-3 py-2.5">
      <div className="flex items-center gap-2">
        <Input
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value)
            setFailedSend(null)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void send()
            }
          }}
          disabled={sending || failure === 'submit'}
          aria-label={translate('dashboardPopout.chat.placeholder', 'Reply to this agent')}
          placeholder={translate('dashboardPopout.chat.placeholder', 'Reply to this agent')}
          className="h-8 text-xs"
        />
        <Button
          type="button"
          size="sm"
          className="h-8"
          disabled={sending || failure === 'submit' || draft.trim().length === 0}
          onClick={() => void send()}
        >
          {translate('dashboardPopout.chat.send', 'Send')}
        </Button>
      </div>
      {failure ? (
        <p className="mt-1.5 text-[11px] text-destructive">
          {failure === 'submit'
            ? translate(
                'dashboardPopout.chat.submitFailed',
                'The reply is in the terminal but could not be submitted. Open the terminal to finish sending it.'
              )
            : translate(
                'dashboardPopout.chat.sendFailed',
                'The reply did not reach the agent. Open the terminal to check it.'
              )}
        </p>
      ) : null}
    </div>
  )
}

function AgentChatBody({
  card,
  mode
}: {
  card: DashboardCard
  mode: AgentChatPanelMode
}): React.JSX.Element {
  if (mode.kind === 'degraded') {
    return <AgentChatFallback card={card} reason={mode.reason} />
  }
  return (
    <AgentChatTranscript
      key={`${card.paneKey}:${mode.sessionId}`}
      card={card}
      sessionId={mode.sessionId}
      transcriptPath={mode.transcriptPath}
    />
  )
}

/** Native chat transcript and reply surface for a dashboard agent. */
export function AgentChatPanel({
  card,
  onClose,
  onOpenTerminal,
  className
}: AgentChatPanelProps): React.JSX.Element {
  const titleId = useId()
  const mode = resolveAgentChatPanelMode(card)

  return (
    <section
      aria-labelledby={titleId}
      className={cn(
        'm-3 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border',
        'bg-popover text-popover-foreground shadow-[0_10px_24px_rgba(0,0,0,0.18)]',
        className
      )}
    >
      <header className="flex shrink-0 items-start gap-2 border-b border-border px-3 py-2.5">
        <AgentStateDot state={card.dotState} size="md" className="mt-0.5" />
        <span className="min-w-0 flex-1">
          <h2 id={titleId} className="truncate text-[12px] leading-normal font-semibold">
            {agentName(card)}
          </h2>
          <span className="block truncate text-[11px] text-muted-foreground">
            {card.repoName} / {card.worktreeName}
          </span>
        </span>
        {onOpenTerminal ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="shrink-0 gap-1.5"
            onClick={onOpenTerminal}
          >
            <SquareTerminal className="size-3.5" />
            {translate('dashboardPopout.chat.openTerminal', 'Open terminal')}
          </Button>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          aria-label={translate('dashboardPopout.chat.close', 'Close chat')}
          className="shrink-0 rounded-sm p-1 text-muted-foreground opacity-70 transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <XIcon className="size-4" />
        </button>
      </header>
      <AgentChatBody card={card} mode={mode} />
      <AgentChatComposer card={card} />
    </section>
  )
}
