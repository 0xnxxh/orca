import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { normalizeReconcileText } from './mobile-native-chat-draft-reconcile'
import type { MobileNativeChatPendingMessage } from './mobile-native-chat-pending-echo'

/**
 * Give the sends that never saw a transcript the boundary they lack, on the
 * first settled read.
 *
 * Such a send has no row to judge candidates against — which held it out of
 * matching entirely, stranding it as a queued bubble and, worse, as a permanent
 * glue barrier for its neighbours.
 *
 * Only a send that captured NO tail is pinned. An unsettled read still shows
 * this session's own retained history (see `createNativeChatTranscriptRetention`
 * — a reconnect or a failed read keeps the conversation on screen rather than
 * blanking it), so a send made then already owns a correct boundary. Moving it
 * onto this read would push it past the send's own echo and strand the bubble
 * for good.
 *
 * The ordinal is deliberately NOT recounted. The read can already carry the
 * send's own echo — a re-subscribe returns whatever exists now — and nothing
 * local separates that echo from an identical older prompt: the transport writes
 * keystrokes into a TUI and carries no message id, and row timestamps come from
 * the host while the send time comes from the phone. Counting it as history puts
 * the ordinal one past anything the transcript can supply.
 *
 * Which is why a CAPTIONED image echo is left alone entirely: it binds its
 * preview by an ordinal counted over the whole transcript, so its tail and its
 * ordinal have to describe the same read. Supplying one without the other leaves
 * it matching nothing, forever. Everything else matches relative to its tail.
 */
export function rebaseMobileNativeChatPendingBaselines(
  messages: readonly NativeChatMessage[],
  current: MobileNativeChatPendingMessage[]
): MobileNativeChatPendingMessage[] {
  if (current.every((item) => item.baselineResolved)) {
    return current
  }
  const baselineTailMessageId = messages.at(-1)?.id ?? null
  return current.map((item) => {
    if (item.baselineResolved) {
      return item
    }
    const bindsByAbsoluteOrdinal =
      Boolean(item.images?.length) && normalizeReconcileText(item.text) !== ''
    return item.baselineTailMessageId !== null || bindsByAbsoluteOrdinal
      ? { ...item, baselineResolved: true }
      : { ...item, baselineResolved: true, baselineTailMessageId }
  })
}
