import { useMemo, useState } from 'react'
import { LoaderCircle, RotateCcw, Send, Square } from 'lucide-react'
import { dispatchStructuredAgentSessionComposerCommand } from '../../../../shared/structured-agent-session-composer'
import type { AgentType } from '../../../../shared/agent-status-types'
import type { NativeChatLiveSession } from './use-native-chat-live-session'
import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import { Button } from '@/components/ui/button'
import { NativeChatApprovalCard } from './NativeChatApprovalCard'
import { NativeChatMessageList } from './NativeChatMessageList'
import { NativeChatQuestionCard } from './NativeChatQuestionCard'
import { NativeChatSessionOptionPickers } from './NativeChatSessionOptionPickers'
import { useStructuredAgentSession } from './use-structured-agent-session'
import { translate } from '@/i18n/i18n'

function encodeQuestionAnswer(questionId: string, answer: string): string {
  return `${encodeURIComponent(questionId)}:${encodeURIComponent(answer)}`
}

export function DesktopStructuredAgentSessionView(props: {
  sessionId: string
  target: RuntimeClientTarget
  agent: AgentType
  allowFileUriLinks: boolean
}): React.JSX.Element {
  const controller = useStructuredAgentSession(props)
  const [draft, setDraft] = useState('')
  const [composerError, setComposerError] = useState<string | null>(null)
  const agentLabel =
    props.agent === 'codex' ? 'Codex' : props.agent === 'claude' ? 'Claude' : props.agent
  const session = useMemo<NativeChatLiveSession>(
    () => ({
      messages: controller.messages,
      status:
        controller.status === 'error'
          ? 'error'
          : controller.status === 'loading'
            ? 'loading'
            : controller.isWorking
              ? 'working'
              : controller.messages.length === 0
                ? 'empty'
                : 'ready',
      sessionId: props.sessionId,
      agent: props.agent,
      ...(controller.error ? { error: controller.error } : {}),
      hasMore: controller.hasOlder,
      loadingEarlier: controller.loadingOlder,
      loadEarlier: () => void controller.loadOlder(),
      readPhase:
        controller.status === 'loading'
          ? 'loading'
          : controller.status === 'error'
            ? 'error'
            : 'ready'
    }),
    [controller, props.agent, props.sessionId]
  )
  const prompt = controller.prompts[0] ?? null
  const questionBody = prompt?.body.kind === 'question' ? prompt.body : null
  const retryableOutboxEntry =
    controller.outbox.find((entry) => entry.state === 'unconfirmed') ??
    controller.outbox.find(
      (entry) => entry.clientMessageId === controller.blockedClientMessageId
    ) ??
    null
  const submit = async (): Promise<void> => {
    const command = await dispatchStructuredAgentSessionComposerCommand(draft, {
      agent: props.agent,
      snapshot: controller.optionSnapshot,
      invokeAction: async () => false,
      setOption: controller.setStructuredOption
    })
    if (command.handled) {
      setComposerError(command.error)
      if (command.accepted) {
        setDraft('')
      }
      return
    }
    if (controller.send(draft)) {
      setDraft('')
      setComposerError(null)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <NativeChatMessageList
        session={session}
        isWorking={controller.isWorking}
        expandSignal={false}
        fontScale={1}
        allowFileUriLinks={props.allowFileUriLinks}
      />
      {prompt?.body.kind === 'approval' ? (
        <NativeChatApprovalCard
          approval={{
            title: prompt.body.title,
            ...(prompt.body.detail ? { detail: prompt.body.detail } : {}),
            options: prompt.body.options.map((option) => ({
              label: option.label,
              send: option.id
            }))
          }}
          onChoose={(optionId) => void controller.respond(prompt, optionId)}
        />
      ) : null}
      {prompt && questionBody ? (
        <NativeChatQuestionCard
          prompt={{
            questions: [
              {
                question: questionBody.question,
                multiSelect: false,
                options: questionBody.options.map((option) => ({ label: option.label }))
              }
            ]
          }}
          allowOther={Boolean(questionBody.freeTextQuestionId)}
          onAnswer={(answers) => {
            const index = answers[0]?.indices[0]
            const other = answers[0]?.other?.trim()
            const optionId =
              typeof index === 'number'
                ? questionBody.options[index]?.id
                : questionBody.freeTextQuestionId && other
                  ? encodeQuestionAnswer(questionBody.freeTextQuestionId, other)
                  : undefined
            if (optionId) {
              void controller.respond(prompt, optionId)
            }
          }}
          onCancel={() => {
            if (controller.turnId) {
              void controller.cancel(controller.turnId)
            }
          }}
        />
      ) : null}
      {retryableOutboxEntry ? (
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-3 px-4 py-1 text-xs text-muted-foreground">
          <span>
            {retryableOutboxEntry.state === 'unconfirmed'
              ? translate(
                  'auto.components.native.chat.DesktopStructuredAgentSessionView.1f772bb5d0',
                  'Message delivery is unconfirmed.'
                )
              : translate(
                  'auto.components.native.chat.DesktopStructuredAgentSessionView.93ef441197',
                  'Message was not sent.'
                )}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => controller.retry(retryableOutboxEntry.clientMessageId)}
          >
            <RotateCcw className="size-3" />
            {translate(
              'auto.components.native.chat.DesktopStructuredAgentSessionView.a5e7f14068',
              'Retry'
            )}
          </Button>
        </div>
      ) : null}
      <div className="shrink-0 border-t border-border bg-background px-3 py-3 sm:px-4">
        <div className="mx-auto w-full max-w-4xl rounded-lg border border-input bg-card shadow-xs">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void submit()
              }
            }}
            disabled={Boolean(prompt)}
            placeholder={
              prompt
                ? translate(
                    'auto.components.native.chat.DesktopStructuredAgentSessionView.1b1ea0a0ab',
                    'Answer the question above'
                  )
                : translate(
                    'auto.components.native.chat.DesktopStructuredAgentSessionView.0b88a4e5e9',
                    'Message {{value0}}',
                    { value0: agentLabel }
                  )
            }
            className="min-h-20 w-full resize-none bg-transparent px-3.5 py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground/60 disabled:opacity-50"
          />
          <div className="flex items-center justify-between gap-2 border-t border-border/60 px-2 py-1.5">
            <NativeChatSessionOptionPickers
              surface={controller.optionSurface}
              snapshot={controller.optionSnapshot}
              isWorking={controller.isWorking}
            />
            {controller.isWorking && controller.turnId ? (
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                aria-label={translate(
                  'auto.components.native.chat.DesktopStructuredAgentSessionView.a78fc7cbde',
                  'Stop response'
                )}
                onClick={() => void controller.cancel(controller.turnId!)}
              >
                <Square className="size-3.5 fill-current" />
              </Button>
            ) : (
              <Button
                type="button"
                size="icon-sm"
                aria-label={translate(
                  'auto.components.native.chat.DesktopStructuredAgentSessionView.25189835dc',
                  'Send message'
                )}
                disabled={!draft.trim() || Boolean(prompt)}
                onClick={() => void submit()}
              >
                {controller.status === 'loading' ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <Send className="size-3.5" />
                )}
              </Button>
            )}
          </div>
        </div>
        {controller.error || composerError ? (
          <p className="mx-auto mt-1.5 w-full max-w-4xl text-xs text-destructive">
            {controller.error ?? composerError}
          </p>
        ) : null}
      </div>
    </div>
  )
}
