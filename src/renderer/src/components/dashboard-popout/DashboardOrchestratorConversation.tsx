import { useState } from 'react'
import { Send, Sparkles, X } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  DASHBOARD_ORCHESTRATOR_CONTEXT_MIME,
  type DashboardOrchestratorContext
} from './dashboard-orchestrator-context'
import type { DashboardOrchestratorMessage } from './dashboard-orchestrator-message-history'

export type { DashboardOrchestratorMessage } from './dashboard-orchestrator-message-history'

type DashboardOrchestratorConversationProps = {
  composerRef: React.RefObject<HTMLTextAreaElement | null>
  contexts: DashboardOrchestratorContext[]
  messages: DashboardOrchestratorMessage[]
  draft: string
  introVisible: boolean
  pendingReply: boolean
  sending: boolean
  sendError: boolean
  targetAvailable: boolean
  onAddContextId: (contextId: string) => void
  onToggleContext: (context: DashboardOrchestratorContext) => void
  onDraftChange: (draft: string) => void
  onHideIntro: () => void
  onSend: () => void
}

const SUGGESTIONS = [
  ['attention', 'What needs my attention across the fleet?'],
  ['summary', 'Summarize active work across every project.'],
  ['stalled', 'Find agents that may be stalled or running unusually long.']
] as const

export function DashboardOrchestratorConversation({
  composerRef,
  contexts,
  messages,
  draft,
  introVisible,
  pendingReply,
  sending,
  sendError,
  targetAvailable,
  onAddContextId,
  onToggleContext,
  onDraftChange,
  onHideIntro,
  onSend
}: DashboardOrchestratorConversationProps): React.JSX.Element {
  const [dropActive, setDropActive] = useState(false)

  return (
    <section className="flex min-h-0 min-w-0 flex-col">
      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col transition-colors',
          dropActive && 'bg-accent/45 ring-2 ring-inset ring-ring'
        )}
        data-orchestrator-drop-zone=""
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes(DASHBOARD_ORCHESTRATOR_CONTEXT_MIME)) {
            event.preventDefault()
            event.dataTransfer.dropEffect = 'copy'
            setDropActive(true)
          }
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setDropActive(false)
          }
        }}
        onDrop={(event) => {
          event.preventDefault()
          setDropActive(false)
          onAddContextId(event.dataTransfer.getData(DASHBOARD_ORCHESTRATOR_CONTEXT_MIME))
        }}
      >
        <div className="shrink-0 border-b border-border px-4 py-2.5">
          <div className="flex min-h-7 flex-wrap items-center gap-1.5">
            {contexts.length === 0 ? (
              <>
                <span className="rounded-full border border-border bg-muted px-2 py-1 text-[10px] font-medium">
                  {translate('dashboardPopout.orchestrator.entireFleet', 'Entire fleet')}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {translate(
                    'dashboardPopout.orchestrator.dropContext',
                    'Drop a worktree or agent here to narrow context'
                  )}
                </span>
              </>
            ) : (
              contexts.map((context) => (
                <span
                  key={context.id}
                  className="inline-flex max-w-48 items-center gap-1 rounded-full border border-border bg-muted px-2 py-1 text-[10px]"
                >
                  <span className="truncate">{context.label}</span>
                  <button
                    type="button"
                    onClick={() => onToggleContext(context)}
                    aria-label={translate(
                      'dashboardPopout.orchestrator.removeContext',
                      'Remove {{context}} from orchestration context',
                      { context: context.label }
                    )}
                    className="rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <X className="size-2.5" />
                  </button>
                </span>
              ))
            )}
          </div>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-4 p-4">
            {introVisible ? (
              <div className="relative rounded-lg border border-border bg-muted/45 p-3 pr-9">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="absolute top-2 right-2"
                  onClick={onHideIntro}
                  aria-label={translate(
                    'dashboardPopout.orchestrator.hideIntro',
                    'Hide introduction'
                  )}
                >
                  <X className="size-3" />
                </Button>
                <span className="flex items-center gap-2 text-xs font-semibold">
                  <Sparkles className="size-3.5" />
                  {translate(
                    'dashboardPopout.orchestrator.globalContext',
                    'One conversation, fleet-wide context'
                  )}
                </span>
                <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                  {translate(
                    'dashboardPopout.orchestrator.globalContextCopy',
                    'Requests use Orca orchestration to inspect and coordinate agents across projects, workspaces, and hosts.'
                  )}
                </p>
              </div>
            ) : null}

            {messages.map((message) =>
              message.role === 'user' ? (
                <div
                  key={message.id}
                  className="ml-12 rounded-lg bg-primary px-3 py-2.5 text-xs text-primary-foreground"
                >
                  {message.text}
                </div>
              ) : (
                <div
                  key={message.id}
                  className="mr-12 rounded-lg border border-border bg-card px-3 py-2.5 text-xs leading-relaxed"
                >
                  {message.text}
                </div>
              )
            )}

            {pendingReply ? (
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <span className="size-1.5 animate-pulse rounded-full bg-foreground" />
                {translate('dashboardPopout.orchestrator.coordinating', 'Coordinating…')}
              </div>
            ) : null}

            {messages.length === 0 ? (
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                  {translate('dashboardPopout.orchestrator.try', 'Try')}
                </span>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {SUGGESTIONS.map(([id, fallback]) => (
                    <Button
                      key={id}
                      type="button"
                      variant="outline"
                      size="xs"
                      className="h-auto min-h-6 whitespace-normal py-1 text-left text-[10px]"
                      onClick={() =>
                        onDraftChange(
                          translate(`dashboardPopout.orchestrator.suggestions.${id}`, fallback)
                        )
                      }
                    >
                      {translate(`dashboardPopout.orchestrator.suggestions.${id}`, fallback)}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </ScrollArea>
      </div>

      <footer className="shrink-0 bg-background px-4 pt-2 pb-4">
        <div className="rounded-lg border border-border bg-muted/50 p-1.5 shadow-xs dark:bg-input/40">
          <textarea
            ref={composerRef}
            value={draft}
            rows={2}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                onSend()
              }
            }}
            placeholder={translate('dashboardPopout.orchestrator.placeholder', 'Ask the fleet…')}
            aria-label={translate(
              'dashboardPopout.orchestrator.composerLabel',
              'Message the orchestrator'
            )}
            className="scrollbar-sleek min-h-12 max-h-[calc(8lh+0.5rem)] w-full resize-none bg-transparent px-2 py-1 text-sm outline-none [field-sizing:content] placeholder:text-muted-foreground/60"
          />
          <div className="flex items-center gap-2 pt-0.5">
            <span
              className={cn(
                'text-[10px]',
                sendError ? 'text-destructive' : 'text-muted-foreground'
              )}
            >
              {sendError
                ? translate('dashboardPopout.orchestrator.sendFailed', 'Send failed')
                : targetAvailable
                  ? translate(
                      'dashboardPopout.orchestrator.globalOrchestration',
                      'Global orchestration'
                    )
                  : translate(
                      'dashboardPopout.orchestrator.startLiveAgentHint',
                      'Start a live agent to enable orchestration'
                    )}
            </span>
            <Button
              type="button"
              size="xs"
              className="ml-auto"
              disabled={!targetAvailable || !draft.trim() || sending}
              onClick={onSend}
              aria-label={translate('dashboardPopout.orchestrator.send', 'Send')}
            >
              <Send className="size-3" />
              {sending
                ? translate('dashboardPopout.orchestrator.sending', 'Sending…')
                : translate('dashboardPopout.orchestrator.send', 'Send')}
            </Button>
          </div>
        </div>
      </footer>
    </section>
  )
}
