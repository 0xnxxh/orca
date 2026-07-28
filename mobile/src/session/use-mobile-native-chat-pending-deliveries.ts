import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MOBILE_WEB_NATIVE_CHAT_PENDING_DELIVERY_LIMIT } from '../../../src/shared/mobile-web/native-chat-operation-contract'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { HostSessionChatPendingDeliveryOperations } from './host-session-chat-pending-delivery-operations'
import {
  countImageSourceTurnsAfter,
  countUserTextOccurrences,
  normalizedUserText
} from './mobile-native-chat-draft-reconcile'

export type MobileNativeChatPendingMessage = {
  id: string
  text: string
  expectedOccurrence: number
  images?: string[]
  baselineTailMessageId: string | null
}

export type MobileNativeChatPendingDeliveryTarget = {
  workspaceId: string
  tabId: string
  sessionId: string
}

export type MobileNativeChatPendingDeliveryOrigin = {
  pendingKey: string | null
  normalizedText: string
  baselineOccurrences: number
  baselineTailMessageId: string | null
  pendingTarget: MobileNativeChatPendingDeliveryTarget | null
}

const NO_PENDING_MESSAGES: MobileNativeChatPendingMessage[] = []

export function useMobileNativeChatPendingDeliveries(args: {
  hostId: string
  worktreeId: string
  tabId: string | null
  sessionId: string | null
  messages: readonly NativeChatMessage[]
  persistence: HostSessionChatPendingDeliveryOperations | null
}): {
  pendingKey: string | null
  pending: MobileNativeChatPendingMessage[]
  captureOrigin: (normalizedText: string) => MobileNativeChatPendingDeliveryOrigin
  accept: (origin: MobileNativeChatPendingDeliveryOrigin, text: string, images?: string[]) => void
} {
  const { hostId, worktreeId, tabId, sessionId, messages, persistence } = args
  const pendingKey = tabId && sessionId ? `${hostId}\0${worktreeId}\0${tabId}\0${sessionId}` : null
  const pendingTarget = useMemo(
    () => (tabId && sessionId ? { workspaceId: worktreeId, tabId, sessionId } : null),
    [sessionId, tabId, worktreeId]
  )
  const [pendingBySession, setPendingBySession] = useState<
    Record<string, MobileNativeChatPendingMessage[]>
  >({})
  const pendingBySessionRef = useRef(pendingBySession)
  pendingBySessionRef.current = pendingBySession
  const editVersionRef = useRef<Record<string, number>>({})
  const hydratedKeysRef = useRef(new Set<string>())
  const nextMessageIdRef = useRef(0)
  const saveQueueRef = useRef(new Map<string, Promise<void>>())

  const queueSave = useCallback(
    (
      key: string,
      target: MobileNativeChatPendingDeliveryTarget,
      deliveries: readonly MobileNativeChatPendingMessage[]
    ) => {
      if (!persistence) {
        return
      }
      const prior = saveQueueRef.current.get(key) ?? Promise.resolve()
      const next = prior
        .catch(() => {})
        .then(() =>
          persistence.save(
            target.workspaceId,
            target.tabId,
            target.sessionId,
            deliveries
              .filter(({ text }) => text.trim().length > 0)
              .map(({ text, expectedOccurrence }) => ({ text, expectedOccurrence }))
          )
        )
      saveQueueRef.current.set(key, next)
      void next.then(
        () => {
          if (saveQueueRef.current.get(key) === next) {
            saveQueueRef.current.delete(key)
          }
        },
        () => {
          if (saveQueueRef.current.get(key) === next) {
            saveQueueRef.current.delete(key)
          }
        }
      )
    },
    [persistence]
  )

  const replacePending = useCallback(
    (
      key: string,
      target: MobileNativeChatPendingDeliveryTarget,
      deliveries: MobileNativeChatPendingMessage[]
    ) => {
      editVersionRef.current[key] = (editVersionRef.current[key] ?? 0) + 1
      const nextState =
        deliveries.length > 0
          ? { ...pendingBySessionRef.current, [key]: deliveries }
          : omitPendingKey(pendingBySessionRef.current, key)
      pendingBySessionRef.current = nextState
      setPendingBySession(nextState)
      queueSave(key, target, deliveries)
    },
    [queueSave]
  )

  useEffect(() => {
    if (!pendingKey || !pendingTarget || !persistence || hydratedKeysRef.current.has(pendingKey)) {
      return
    }
    let active = true
    const editVersion = editVersionRef.current[pendingKey] ?? 0
    void persistence
      .load(pendingTarget.workspaceId, pendingTarget.tabId, pendingTarget.sessionId)
      .then((stored) => {
        hydratedKeysRef.current.add(pendingKey)
        if (!active || (editVersionRef.current[pendingKey] ?? 0) !== editVersion) {
          return
        }
        const deliveries = stored.map((delivery) => ({
          id: nextPendingMessageId(nextMessageIdRef),
          ...delivery,
          baselineTailMessageId: null
        }))
        const nextState =
          deliveries.length > 0
            ? { ...pendingBySessionRef.current, [pendingKey]: deliveries }
            : pendingBySessionRef.current
        pendingBySessionRef.current = nextState
        setPendingBySession(nextState)
      })
      .catch(() => {
        hydratedKeysRef.current.add(pendingKey)
      })
    return () => {
      active = false
    }
  }, [pendingKey, pendingTarget, persistence])

  const captureOrigin = useCallback(
    (normalizedText: string): MobileNativeChatPendingDeliveryOrigin => ({
      pendingKey,
      normalizedText,
      baselineOccurrences: countUserTextOccurrences(messages, normalizedText),
      baselineTailMessageId: messages[messages.length - 1]?.id ?? null,
      pendingTarget
    }),
    [messages, pendingKey, pendingTarget]
  )

  const accept = useCallback(
    (origin: MobileNativeChatPendingDeliveryOrigin, text: string, images?: string[]) => {
      if (!origin.pendingKey || !origin.pendingTarget) {
        return
      }
      const current = pendingBySessionRef.current[origin.pendingKey] ?? NO_PENDING_MESSAGES
      const earlierOutstanding = current.filter(
        (pending) =>
          pending.text.trim() === origin.normalizedText &&
          pending.expectedOccurrence > origin.baselineOccurrences
      ).length
      const expectedImageEchoOrdinal =
        current.reduce(
          (sum, pending) => sum + (pending.images?.length ?? (pending.text.trim() === '' ? 1 : 0)),
          0
        ) + 1
      const next = [
        ...current,
        {
          id: nextPendingMessageId(nextMessageIdRef),
          text,
          expectedOccurrence:
            origin.normalizedText === ''
              ? expectedImageEchoOrdinal
              : origin.baselineOccurrences + earlierOutstanding + 1,
          baselineTailMessageId: origin.baselineTailMessageId,
          ...(images && images.length > 0 ? { images } : {})
        }
      ].slice(-MOBILE_WEB_NATIVE_CHAT_PENDING_DELIVERY_LIMIT)
      replacePending(origin.pendingKey, origin.pendingTarget, next)
    },
    [replacePending]
  )

  const pending = pendingKey
    ? (pendingBySession[pendingKey] ?? NO_PENDING_MESSAGES)
    : NO_PENDING_MESSAGES
  useEffect(() => {
    if (!pendingKey || !pendingTarget || pending.length === 0) {
      return
    }
    const landedCounts = new Map<string, number>()
    for (const message of messages) {
      const text = normalizedUserText(message)
      if (text) {
        landedCounts.set(text, (landedCounts.get(text) ?? 0) + 1)
      }
    }
    const next = pending.filter((item) =>
      item.text.trim() === ''
        ? countImageSourceTurnsAfter(messages, item.baselineTailMessageId) < item.expectedOccurrence
        : (landedCounts.get(item.text.trim()) ?? 0) < item.expectedOccurrence
    )
    if (next.length !== pending.length) {
      replacePending(pendingKey, pendingTarget, next)
    }
  }, [messages, pending, pendingKey, pendingTarget, replacePending])

  return { pendingKey, pending, captureOrigin, accept }
}

function nextPendingMessageId(counter: { current: number }): string {
  counter.current += 1
  return `pending-${counter.current}`
}

function omitPendingKey(
  state: Record<string, MobileNativeChatPendingMessage[]>,
  key: string
): Record<string, MobileNativeChatPendingMessage[]> {
  const next = { ...state }
  delete next[key]
  return next
}
