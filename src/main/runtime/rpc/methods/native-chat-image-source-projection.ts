import {
  countImagePromptMarkers,
  imageSourcePathFromText,
  isImageSourceUserTurn
} from '../../../../shared/native-chat-image-transcript-markers'
import {
  isTextBlock,
  type NativeChatMessage,
  type NativeChatTurnLifecycle
} from '../../../../shared/native-chat-types'

const LEGACY_APPEND_HOLD_MS = 25

/** Keep RPC image-source rows readable by released single-block peers. */
export function projectNativeChatRpcImageSourceMessage(
  message: NativeChatMessage
): NativeChatMessage[] {
  if (
    message.role !== 'user' ||
    message.blocks.length <= 1 ||
    !message.blocks.every(
      (block) => isTextBlock(block) && imageSourcePathFromText(block.text) !== null
    )
  ) {
    return [message]
  }
  // Why: derived IDs preserve transcript provenance across append/replacement.
  return message.blocks.map((block, index) => ({
    ...message,
    id: index === 0 ? message.id : `${message.id}:image-source:${index}`,
    blocks: [block]
  }))
}

function legacySourceRun(
  messages: readonly NativeChatMessage[],
  start: number,
  source: NativeChatMessage['source']
): { end: number; messages: NativeChatMessage[] } {
  const projected: NativeChatMessage[] = []
  let end = start
  while (end < messages.length) {
    const candidate = messages[end]!
    if (candidate.source !== source || !isImageSourceUserTurn(candidate)) {
      break
    }
    projected.push(...projectNativeChatRpcImageSourceMessage(candidate))
    end += 1
  }
  return { end, messages: projected }
}

/** Reorder prompt-first Claude pairs for the released source-before-prompt
 *  normalizer, while retaining its one-source-per-row contract. */
export function projectNativeChatLegacyImageSourceMessages(
  messages: readonly NativeChatMessage[]
): NativeChatMessage[] {
  const projected: NativeChatMessage[] = []
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!
    const markerCount = countImagePromptMarkers(message)
    if (message.role === 'user' && markerCount > 0) {
      const sources = legacySourceRun(messages, index + 1, message.source)
      if (sources.messages.length === markerCount) {
        projected.push(...sources.messages, message)
        index = sources.end - 1
        continue
      }
    }
    projected.push(...projectNativeChatRpcImageSourceMessage(message))
  }
  return projected
}

/** Holds at most one trailing prompt for one event-loop turn so a 40-row
 *  incremental-reader boundary cannot publish prompt-before-source to legacy peers. */
export function createNativeChatLegacyAppendProjector(
  emit: (messages: NativeChatMessage[], lifecycle?: NativeChatTurnLifecycle) => void
): {
  push: (messages: readonly NativeChatMessage[], lifecycle?: NativeChatTurnLifecycle) => void
  reset: () => void
  close: () => void
} {
  let pending: NativeChatMessage | null = null
  let pendingLifecycle: NativeChatTurnLifecycle | undefined
  let timer: ReturnType<typeof setTimeout> | null = null
  let closed = false

  const cancelTimer = (): void => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }
  const flush = (): void => {
    cancelTimer()
    if (closed || !pending) {
      return
    }
    const message = pending
    const lifecycle = pendingLifecycle
    pending = null
    pendingLifecycle = undefined
    emit(projectNativeChatLegacyImageSourceMessages([message]), lifecycle)
  }
  const scheduleFlush = (): void => {
    timer = setTimeout(flush, LEGACY_APPEND_HOLD_MS)
    timer.unref?.()
  }
  const reset = (): void => {
    cancelTimer()
    pending = null
    pendingLifecycle = undefined
  }

  return {
    push: (messages, lifecycle) => {
      if (closed) {
        return
      }
      cancelTimer()
      const combined = pending ? [pending, ...messages] : [...messages]
      pending = null
      pendingLifecycle = undefined
      const trailing = combined.at(-1)
      if (
        trailing?.role === 'user' &&
        !isImageSourceUserTurn(trailing) &&
        countImagePromptMarkers(trailing) > 0
      ) {
        pending = trailing
        pendingLifecycle = lifecycle
        combined.pop()
      }
      const output = projectNativeChatLegacyImageSourceMessages(combined)
      if (output.length > 0 || (lifecycle && !pending)) {
        emit(output, lifecycle)
      }
      if (pending) {
        scheduleFlush()
      }
    },
    reset,
    close: () => {
      closed = true
      reset()
    }
  }
}
