import * as ExpoCrypto from 'expo-crypto'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AgentJournalRenderItem,
  AgentJournalSubmission
} from '../../../src/shared/agent-session-journal-types'
import type {
  AgentSessionMutationResult,
  AgentSessionSendResult
} from '../../../src/shared/agent-session-wire'
import type { RpcClient } from '../transport/rpc-client'
import type { PendingNativeChatImage } from './mobile-native-chat-image-attachment'
import {
  isMobileStructuredDeliveryUnknown,
  mobileStructuredSendBody,
  updateMobileStructuredOutboxEntry
} from './mobile-structured-outbox-entry'
import {
  createMobileStructuredOperationId,
  mobileStructuredPayloadFingerprint
} from './mobile-structured-mutation-envelope'
import {
  loadMobileStructuredOutbox,
  saveMobileStructuredOutbox,
  type MobileStructuredOutboxEntry
} from './mobile-structured-outbox-store'
import {
  useMobileStructuredSessionMutations,
  type MobileStructuredSessionMutations
} from './use-mobile-structured-session-mutations'

export type MobileStructuredSessionWrites = MobileStructuredSessionMutations & {
  outbox: MobileStructuredOutboxEntry[]
  hydrated: boolean
  error: string | null
  send: (text: string, attachments?: readonly PendingNativeChatImage[]) => Promise<boolean>
  takeQueuedForEdit: (clientMessageId: string) => Promise<MobileStructuredOutboxEntry | null>
  retry: (clientMessageId: string) => Promise<void>
}

export function useMobileStructuredSessionWrites(args: {
  client: RpcClient | null
  sessionId: string | null
  fence: number | null
  items: readonly AgentJournalRenderItem[]
  submissions: readonly AgentJournalSubmission[]
}): MobileStructuredSessionWrites {
  const { client, sessionId, fence, submissions } = args
  const [outbox, setOutbox] = useState<MobileStructuredOutboxEntry[]>([])
  const [hydrated, setHydrated] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dispatchVersion, setDispatchVersion] = useState(0)
  const outboxRef = useRef(outbox)
  outboxRef.current = outbox
  const persistTailRef = useRef<Promise<void>>(Promise.resolve())
  const dispatchingRef = useRef(false)
  const blockedIdRef = useRef<string | null>(null)
  const activeSessionRef = useRef(sessionId)
  activeSessionRef.current = sessionId
  const mutations = useMobileStructuredSessionMutations({
    client,
    sessionId,
    fence,
    onRefusal: setError
  })

  const persist = useCallback((targetSessionId: string, entries: MobileStructuredOutboxEntry[]) => {
    const write = persistTailRef.current.then(() =>
      saveMobileStructuredOutbox(targetSessionId, entries)
    )
    persistTailRef.current = write.catch(() => {})
    return write
  }, [])

  useEffect(() => {
    setOutbox([])
    setHydrated(false)
    setError(null)
    blockedIdRef.current = null
    if (!sessionId) {
      return
    }
    let stale = false
    void loadMobileStructuredOutbox(sessionId).then((entries) => {
      if (!stale) {
        outboxRef.current = entries
        setOutbox(entries)
        setHydrated(true)
      }
    })
    return () => {
      stale = true
    }
  }, [sessionId])

  useEffect(() => {
    if (!sessionId || submissions.length === 0 || outboxRef.current.length === 0) {
      return
    }
    const settled = new Map(
      submissions.map((submission) => [submission.clientMessageId, submission])
    )
    const next = outboxRef.current.flatMap((entry) => {
      const submission = settled.get(entry.clientMessageId)
      if (submission?.dispatchState === 'accepted') {
        return []
      }
      if (submission?.dispatchState === 'unknown') {
        return [{ ...entry, state: 'unconfirmed' as const }]
      }
      return [entry]
    })
    if (
      next.length !== outboxRef.current.length ||
      next.some((entry, index) => entry !== outboxRef.current[index])
    ) {
      outboxRef.current = next
      setOutbox(next)
      void persist(sessionId, next)
    }
  }, [persist, sessionId, submissions])

  const replaceEntry = useCallback(
    async (
      id: string,
      update: (entry: MobileStructuredOutboxEntry) => MobileStructuredOutboxEntry | null
    ): Promise<void> => {
      if (!sessionId) {
        return
      }
      const next = updateMobileStructuredOutboxEntry(outboxRef.current, id, update)
      outboxRef.current = next
      setOutbox(next)
      await persist(sessionId, next)
    },
    [persist, sessionId]
  )

  useEffect(() => {
    const next = outbox.find((entry) => entry.state === 'queued')
    if (
      !client ||
      !sessionId ||
      fence === null ||
      !hydrated ||
      !next ||
      dispatchingRef.current ||
      blockedIdRef.current === next.clientMessageId ||
      client.getState() !== 'connected'
    ) {
      return
    }
    dispatchingRef.current = true
    const targetSessionId = sessionId
    void (async () => {
      try {
        await replaceEntry(next.clientMessageId, (entry) => ({
          ...entry,
          state: 'dispatching',
          lastAttemptAt: Date.now()
        }))
        const fields = { body: next.body }
        const response = await client.sendRequest('agentSession.send', {
          envelope: {
            sessionId,
            clientOperationId: next.clientMessageId,
            expectedRuntimeFence: fence,
            payloadFingerprint: mobileStructuredPayloadFingerprint({
              method: 'agentSession.send',
              sessionId,
              fields
            })
          },
          ...fields
        })
        if (activeSessionRef.current !== targetSessionId) {
          return
        }
        if (!response.ok) {
          throw new Error(response.error.message)
        }
        const result = response.result as AgentSessionMutationResult<AgentSessionSendResult>
        if (!result.ok) {
          blockedIdRef.current = next.clientMessageId
          setError(result.refusal.message)
          await replaceEntry(next.clientMessageId, (entry) => ({ ...entry, state: 'queued' }))
          return
        }
        if (result.value.submission.dispatchState === 'unknown') {
          await replaceEntry(next.clientMessageId, (entry) => ({ ...entry, state: 'unconfirmed' }))
          return
        }
        if (result.value.submission.dispatchState === 'rejected') {
          blockedIdRef.current = next.clientMessageId
          setError(result.value.submission.reason ?? 'Message was not accepted')
          await replaceEntry(next.clientMessageId, (entry) => ({ ...entry, state: 'queued' }))
          return
        }
        setError(null)
        await replaceEntry(next.clientMessageId, () => null)
      } catch (caught) {
        if (activeSessionRef.current !== targetSessionId) {
          return
        }
        if (isMobileStructuredDeliveryUnknown(caught)) {
          await replaceEntry(next.clientMessageId, (entry) => ({ ...entry, state: 'unconfirmed' }))
        } else {
          blockedIdRef.current = next.clientMessageId
          setError(caught instanceof Error ? caught.message : 'Message was not sent')
          await replaceEntry(next.clientMessageId, (entry) => ({ ...entry, state: 'queued' }))
        }
      } finally {
        dispatchingRef.current = false
        setDispatchVersion((current) => current + 1)
      }
    })()
  }, [client, dispatchVersion, fence, hydrated, outbox, replaceEntry, sessionId])

  const send = useCallback(
    async (text: string, attachments: readonly PendingNativeChatImage[] = []): Promise<boolean> => {
      if (!sessionId || (!text.trim() && attachments.length === 0)) {
        return false
      }
      const entry: MobileStructuredOutboxEntry = {
        clientMessageId: createMobileStructuredOperationId('mobile-send', () =>
          ExpoCrypto.randomUUID()
        ),
        sessionId,
        body: mobileStructuredSendBody(text, attachments),
        previewUris: attachments.map((attachment) => attachment.previewUri),
        state: 'queued',
        queuedAt: Date.now(),
        lastAttemptAt: null
      }
      const next = [...outboxRef.current, entry]
      try {
        await persist(sessionId, next)
      } catch {
        setError('Message could not be saved to the outbox')
        return false
      }
      outboxRef.current = next
      setOutbox(next)
      setError(null)
      return true
    },
    [persist, sessionId]
  )

  const takeQueuedForEdit = useCallback(
    async (clientMessageId: string): Promise<MobileStructuredOutboxEntry | null> => {
      const current = outboxRef.current.find((entry) => entry.clientMessageId === clientMessageId)
      if (!current || current.state !== 'queued') {
        return null
      }
      blockedIdRef.current = null
      await replaceEntry(clientMessageId, () => null)
      return current
    },
    [replaceEntry]
  )

  const retry = useCallback(
    async (clientMessageId: string): Promise<void> => {
      blockedIdRef.current = null
      setError(null)
      await replaceEntry(clientMessageId, (entry) => ({ ...entry, state: 'queued' }))
    },
    [replaceEntry]
  )

  return useMemo(
    () => ({
      outbox,
      hydrated,
      error,
      send,
      takeQueuedForEdit,
      retry,
      ...mutations
    }),
    [error, hydrated, mutations, outbox, retry, send, takeQueuedForEdit]
  )
}
