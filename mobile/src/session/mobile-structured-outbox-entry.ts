import type {
  AgentJournalMessageItem,
  AgentJournalSubmission
} from '../../../src/shared/agent-session-journal-types'
import { isRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import { isLogicalClientCutoverError } from '../transport/stable-logical-rpc-client'
import type { PendingNativeChatImage } from './mobile-native-chat-image-attachment'
import type { MobileStructuredOutboxEntry } from './mobile-structured-outbox-store'

export function mobileStructuredSendBody(
  text: string,
  attachments: readonly PendingNativeChatImage[]
): AgentJournalMessageItem {
  return {
    kind: 'message',
    role: 'user',
    blocks: [
      ...(text.trim().length > 0 ? [{ type: 'text' as const, text: text.trimEnd() }] : []),
      ...attachments.map((attachment) => ({ type: 'image-ref' as const, path: attachment.path }))
    ]
  }
}

export function updateMobileStructuredOutboxEntry(
  entries: readonly MobileStructuredOutboxEntry[],
  id: string,
  update: (entry: MobileStructuredOutboxEntry) => MobileStructuredOutboxEntry | null
): MobileStructuredOutboxEntry[] {
  return entries.flatMap((entry) => {
    if (entry.clientMessageId !== id) {
      return [entry]
    }
    const next = update(entry)
    return next ? [next] : []
  })
}

export function createMobileStructuredOutboxEntry(args: {
  clientMessageId: string
  sessionId: string
  text: string
  attachments: readonly PendingNativeChatImage[]
  queuedAt: number
}): MobileStructuredOutboxEntry {
  return {
    clientMessageId: args.clientMessageId,
    sessionId: args.sessionId,
    body: mobileStructuredSendBody(args.text, args.attachments),
    previewUris: args.attachments.map((attachment) => attachment.previewUri),
    state: 'queued',
    queuedAt: args.queuedAt,
    lastAttemptAt: null,
    retryAfterUnknownSubmittedAt: null
  }
}

export function reconcileMobileStructuredOutbox(
  entries: readonly MobileStructuredOutboxEntry[],
  submissions: readonly AgentJournalSubmission[]
): MobileStructuredOutboxEntry[] {
  const settled = new Map(submissions.map((entry) => [entry.clientMessageId, entry]))
  return entries.flatMap((entry) => {
    const submission = settled.get(entry.clientMessageId)
    if (submission?.dispatchState === 'accepted') {
      return []
    }
    if (
      submission?.dispatchState === 'unknown' &&
      entry.retryAfterUnknownSubmittedAt !== -1 &&
      entry.retryAfterUnknownSubmittedAt !== submission.submittedAt
    ) {
      return [{ ...entry, state: 'unconfirmed' as const }]
    }
    return [entry]
  })
}

export function isMobileStructuredDeliveryUnknown(error: unknown): boolean {
  return isRpcDeliveryUnknown(error) || isLogicalClientCutoverError(error)
}
