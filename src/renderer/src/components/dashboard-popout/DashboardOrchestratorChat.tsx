import { useEffect, useMemo, useRef, useState } from 'react'
import { BotMessageSquare, Sparkles } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  buildNativeChatPasteBytes,
  NATIVE_CHAT_SUBMIT
} from '@/components/native-chat/native-chat-send'
import type { DashboardCard } from '../../../../shared/dashboard-snapshot'
import { DashboardOrchestratorConversation } from './DashboardOrchestratorConversation'
import { DashboardOrchestratorFleetRail } from './DashboardOrchestratorFleetRail'
import {
  buildDashboardOrchestrationPrompt,
  buildDashboardOrchestratorProjects,
  listDashboardOrchestratorContexts,
  type DashboardOrchestratorContext,
  type DashboardOrchestratorProject
} from './dashboard-orchestrator-context'
import {
  appendDashboardOrchestratorMessage,
  type DashboardOrchestratorMessage
} from './dashboard-orchestrator-message-history'

type PendingReply = {
  paneKey: string
  previousMessage: string | null
}

const ORCHESTRATION_COMMAND = '$orchestration'
const EMPTY_PROJECTS: DashboardOrchestratorProject[] = []
const EMPTY_CONTEXTS_BY_ID = new Map<string, DashboardOrchestratorContext>()

function candidateRank(card: DashboardCard): number {
  const coordinatorEvidence = (card.subagents?.length ?? 0) > 0 ? 0 : 100
  const stateRank = card.bucket === 'attention' ? 0 : card.bucket === 'working' ? 10 : 20
  return coordinatorEvidence + stateRank
}

function bestFleetCandidate(cards: DashboardCard[]): DashboardCard | null {
  let best: DashboardCard | null = null
  let bestRank = Number.POSITIVE_INFINITY
  for (const card of cards) {
    if (card.ptyId === null) {
      continue
    }
    const rank = candidateRank(card)
    if (
      !best ||
      rank < bestRank ||
      (rank === bestRank && card.stateChangedAt > best.stateChangedAt)
    ) {
      best = card
      bestRank = rank
    }
  }
  return best
}

export function DashboardOrchestratorChat({
  cards
}: {
  cards: DashboardCard[]
}): React.JSX.Element {
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const nextMessageId = useRef(0)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState(false)
  const [introVisible, setIntroVisible] = useState(true)
  const [contexts, setContexts] = useState<DashboardOrchestratorContext[]>([])
  const [messages, setMessages] = useState<DashboardOrchestratorMessage[]>([])
  const [pendingReply, setPendingReply] = useState<PendingReply | null>(null)
  const target = useMemo(() => bestFleetCandidate(cards), [cards])
  const projects = useMemo(
    () => (open ? buildDashboardOrchestratorProjects(cards) : EMPTY_PROJECTS),
    [cards, open]
  )
  const contextsById = useMemo(
    () =>
      open
        ? new Map(
            listDashboardOrchestratorContexts(projects).map((context) => [context.id, context])
          )
        : EMPTY_CONTEXTS_BY_ID,
    [open, projects]
  )
  const selectedContextIds = useMemo(
    () => new Set(contexts.map((context) => context.id)),
    [contexts]
  )

  useEffect(() => {
    if (!pendingReply) {
      return
    }
    const reply = cards
      .find((card) => card.paneKey === pendingReply.paneKey)
      ?.lastAgentMessage?.trim()
    if (!reply || reply === pendingReply.previousMessage) {
      return
    }
    nextMessageId.current += 1
    setMessages((current) =>
      appendDashboardOrchestratorMessage(current, {
        id: nextMessageId.current,
        role: 'assistant',
        text: reply
      })
    )
    setPendingReply(null)
  }, [cards, pendingReply])

  const toggleContext = (context: DashboardOrchestratorContext): void => {
    setContexts((current) =>
      current.some((entry) => entry.id === context.id)
        ? current.filter((entry) => entry.id !== context.id)
        : [...current, context]
    )
  }

  const addContextId = (contextId: string): void => {
    const context = contextsById.get(contextId)
    if (!context) {
      return
    }
    setContexts((current) =>
      current.some((entry) => entry.id === context.id) ? current : [...current, context]
    )
  }

  const send = async (): Promise<void> => {
    const message = draft.trim()
    if (!message || !target?.ptyId || sending) {
      return
    }
    setSending(true)
    setSendError(false)
    try {
      const bodySent = await window.api.terminalPreview.input(
        target.ptyId,
        buildNativeChatPasteBytes(buildDashboardOrchestrationPrompt(message, contexts))
      )
      const submitted =
        bodySent && (await window.api.terminalPreview.input(target.ptyId, NATIVE_CHAT_SUBMIT))
      if (!submitted) {
        setSendError(true)
        return
      }
      nextMessageId.current += 1
      setMessages((current) =>
        appendDashboardOrchestratorMessage(current, {
          id: nextMessageId.current,
          role: 'user',
          text: message
        })
      )
      setPendingReply({
        paneKey: target.paneKey,
        previousMessage: target.lastAgentMessage?.trim() ?? null
      })
      setIntroVisible(false)
      setDraft('')
    } catch {
      setSendError(true)
    } finally {
      setSending(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          className="absolute right-4 bottom-4 z-30 h-10 gap-2 rounded-full px-4 shadow-[0_10px_24px_rgba(0,0,0,0.18)]"
        >
          <span className="relative">
            <BotMessageSquare className="size-4" />
            <span
              className={cn(
                'absolute -top-0.5 -right-0.5 size-1.5 rounded-full ring-2 ring-primary',
                target ? 'bg-status-success' : 'bg-muted-foreground/45'
              )}
            />
          </span>
          {translate('dashboardPopout.orchestrator.trigger', 'Orchestrate')}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={10}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          composerRef.current?.focus()
        }}
        className="flex h-[min(680px,calc(100vh-96px))] w-[min(780px,calc(100vw-32px))] flex-col overflow-hidden p-0"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
          <span className="grid size-9 place-items-center rounded-lg border border-border bg-muted">
            <Sparkles className="size-4" />
          </span>
          <span className="min-w-0">
            <strong className="block text-sm">
              {translate('dashboardPopout.orchestrator.title', 'Orchestrator')}
            </strong>
            <span className="block text-[11px] text-muted-foreground">
              {translate('dashboardPopout.orchestrator.scope', 'Global fleet · {{count}} agents', {
                count: cards.length
              })}
            </span>
          </span>
          <span className="ml-auto flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <i
              className={cn(
                'size-1.5 rounded-full',
                target ? 'bg-status-success' : 'bg-muted-foreground/45'
              )}
            />
            {target
              ? translate('dashboardPopout.orchestrator.ready', 'Ready')
              : translate('dashboardPopout.orchestrator.noLiveAgentStatus', 'No live agent')}
          </span>
        </header>
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/30 px-4 py-2">
          <code className="rounded-md border border-border bg-background px-2 py-1 text-[11px] font-semibold">
            {ORCHESTRATION_COMMAND}
          </code>
          <span className="text-[10px] text-muted-foreground">
            {translate('dashboardPopout.orchestrator.commandActive', 'Global fleet command active')}
          </span>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-[250px_minmax(0,1fr)]">
          <DashboardOrchestratorFleetRail
            projects={projects}
            selectedContextIds={selectedContextIds}
            onToggleContext={toggleContext}
          />
          <DashboardOrchestratorConversation
            composerRef={composerRef}
            contexts={contexts}
            messages={messages}
            draft={draft}
            introVisible={introVisible}
            pendingReply={pendingReply !== null}
            sending={sending}
            sendError={sendError}
            targetAvailable={target !== null}
            onAddContextId={addContextId}
            onToggleContext={toggleContext}
            onDraftChange={setDraft}
            onHideIntro={() => setIntroVisible(false)}
            onSend={() => void send()}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}
