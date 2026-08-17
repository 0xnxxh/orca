import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { normalizeReconcileText } from './mobile-native-chat-draft-reconcile'
import type { MobileNativeChatPendingMessage } from './mobile-native-chat-pending-echo'

/**
 * Give the sends issued before this session's history was known the boundary
 * they never had, on the first authoritative read.
 *
 * Such a send saw no transcript, so it has no row it can judge candidates
 * against — which held it out of matching entirely, stranding it as a queued
 * bubble and, worse, as a permanent glue barrier for its neighbours. Recovering
 * the tail is all that is needed: the ordinal was already counted against an
 * empty transcript, which is exactly right for "no history was known".
 *
 * The ordinal is deliberately NOT recounted against this read. The read can
 * already carry the send's own echo — a re-subscribe after a tab switch or a
 * reconnect returns whatever exists now — and nothing local separates that echo
 * from an identical older prompt: the transport writes keystrokes into a TUI and
 * carries no message id, and row timestamps come from the host while the send
 * time comes from the phone. Counting it as history puts the ordinal one past
 * anything the transcript can supply, which strands the bubble for the rest of
 * the session and stops its whole run from ever gluing.
 *
 * A caption-less image echo keeps its captured tail: it reconciles by counting
 * image turns AFTER that tail, so pinning the tail past this read would throw
 * away an echo the read already carries.
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
    return item.images?.length || normalizeReconcileText(item.text) === ''
      ? { ...item, baselineResolved: true }
      : { ...item, baselineResolved: true, baselineTailMessageId }
  })
}
