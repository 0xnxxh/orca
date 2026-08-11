import { REMOTE_RUNTIME_MAX_OUTBOUND_JSON_BYTES } from '../../../shared/remote-runtime-capacity-limits'
import type { RpcEnvelopeMeta, RpcResponse } from './core'
import type { RpcDispatchStreamingOptions } from './dispatcher-stream-options'
import { errorResponse } from './errors'
import {
  RESPONSE_TOO_LARGE_CODE,
  RESPONSE_TOO_LARGE_MESSAGE,
  type OversizedReplyReport
} from './oversized-reply-report'

type OutboundReplyAdmission =
  | { serialized: string; report?: undefined; replacement?: undefined }
  /** No replacement means the reply cannot be failed in place; the socket has to go. */
  | { serialized?: undefined; report: OversizedReplyReport; replacement?: string }

export type BoundedReplyChannel = {
  replyResponse: (response: RpcResponse) => void
  repliesSuppressed: () => boolean
}

type BoundedReplyChannelInput = {
  reply: (response: string) => void
  meta: RpcEnvelopeMeta
  /** Registry-validated, so a client-supplied name cannot reach logs or telemetry. */
  method: string
  options?: Pick<
    RpcDispatchStreamingOptions,
    'shouldSuppressReplies' | 'onOutboundReplyOverflow' | 'onOutboundReplyTooLarge'
  >
}

function admitOutboundReply(
  response: RpcResponse,
  meta: RpcEnvelopeMeta,
  method: string
): OutboundReplyAdmission {
  const serialized = JSON.stringify(response)
  // Why: same constant and UTF-8 measure as the channel's size admission
  // (mobile-e2ee-outbound-admission.ts), so the two size checks cannot disagree. This is a
  // backstop — producers cap themselves — so it favours a fast admit over a bounded reject.
  const byteLength = Buffer.byteLength(serialized, 'utf8')
  if (byteLength <= REMOTE_RUNTIME_MAX_OUTBOUND_JSON_BYTES) {
    return { serialized }
  }
  const report = { method, byteLength, streaming: response.ok && response.streaming === true }
  // Why: a mid-stream emit cannot be replaced by a terminal error. Subscription handlers resolve
  // through registerSubscriptionCleanup and never read the abort signal, so failing the request
  // would leak the runtime listener while the client resubscribes.
  if (report.streaming) {
    return { report }
  }
  const replacement = JSON.stringify(
    errorResponse(response.id, meta, RESPONSE_TOO_LARGE_CODE, RESPONSE_TOO_LARGE_MESSAGE, {
      byteLength,
      maxBytes: REMOTE_RUNTIME_MAX_OUTBOUND_JSON_BYTES
    })
  )
  // A pathological request id can push even the replacement over the limit.
  return Buffer.byteLength(replacement, 'utf8') <= REMOTE_RUNTIME_MAX_OUTBOUND_JSON_BYTES
    ? { report, replacement }
    : { report }
}

/** One dispatch's outbound replies: size admission plus the latch that silences what follows. */
export function createBoundedReplyChannel(input: BoundedReplyChannelInput): BoundedReplyChannel {
  const { reply, meta, method, options } = input
  let overflowed = false
  const repliesSuppressed = (): boolean => overflowed || options?.shouldSuppressReplies?.() === true
  return {
    repliesSuppressed,
    replyResponse: (response) => {
      if (repliesSuppressed()) {
        return
      }
      const admission = admitOutboundReply(response, meta, method)
      if (admission.serialized !== undefined) {
        reply(admission.serialized)
        return
      }
      if (!admission.replacement && !options?.onOutboundReplyOverflow) {
        throw new Error(
          `Outbound RPC reply exceeds ${REMOTE_RUNTIME_MAX_OUTBOUND_JSON_BYTES} bytes`
        )
      }
      overflowed = true
      if (admission.replacement) {
        options?.onOutboundReplyTooLarge?.(admission.report)
        reply(admission.replacement)
        return
      }
      options?.onOutboundReplyOverflow?.(admission.report)
    }
  }
}
