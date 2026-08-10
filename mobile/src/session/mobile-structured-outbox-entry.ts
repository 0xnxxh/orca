import type { AgentJournalMessageItem } from '../../../src/shared/agent-session-journal-types'
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

export function isMobileStructuredDeliveryUnknown(error: unknown): boolean {
  return isRpcDeliveryUnknown(error) || isLogicalClientCutoverError(error)
}
