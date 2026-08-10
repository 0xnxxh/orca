import * as ExpoCrypto from 'expo-crypto'
import { useCallback, useMemo, useRef } from 'react'
import type {
  AgentJournalApprovalItem,
  AgentJournalQuestionItem,
  AgentJournalRenderItem
} from '../../../src/shared/agent-session-journal-types'
import type {
  AgentSessionMutationResult,
  AgentSessionPromptResult
} from '../../../src/shared/agent-session-wire'
import type { RpcClient } from '../transport/rpc-client'
import { isRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import { isLogicalClientCutoverError } from '../transport/stable-logical-rpc-client'
import {
  createMobileStructuredOperationId,
  mobileStructuredPayloadFingerprint
} from './mobile-structured-mutation-envelope'

export type MobileStructuredPromptItem = AgentJournalRenderItem & {
  body: AgentJournalApprovalItem | AgentJournalQuestionItem
}

export type MobileStructuredSessionMutations = {
  respondToPrompt: (item: MobileStructuredPromptItem, optionId: string) => Promise<boolean>
  setOption: (key: string, value: string) => Promise<boolean>
  cancel: (turnId: string) => Promise<boolean>
}

export function useMobileStructuredSessionMutations(args: {
  client: RpcClient | null
  sessionId: string | null
  fence: number | null
  onRefusal: (message: string | null) => void
}): MobileStructuredSessionMutations {
  const operationIdsRef = useRef(new Map<string, string>())
  const { client, fence, onRefusal, sessionId } = args
  const mutate = useCallback(
    async <TValue>(method: string, fingerprintMethod: string, fields: Record<string, unknown>) => {
      if (!client || !sessionId || fence === null || client.getState() !== 'connected') {
        return null
      }
      const mutationKey = `${fingerprintMethod}:${JSON.stringify(fields)}`
      const clientOperationId =
        operationIdsRef.current.get(mutationKey) ??
        createMobileStructuredOperationId('mobile-mutation', () => ExpoCrypto.randomUUID())
      operationIdsRef.current.set(mutationKey, clientOperationId)
      let response
      try {
        response = await client.sendRequest(method, {
          envelope: {
            sessionId,
            clientOperationId,
            expectedRuntimeFence: fence,
            payloadFingerprint: mobileStructuredPayloadFingerprint({
              method: fingerprintMethod,
              sessionId,
              fields
            })
          },
          ...fields
        })
      } catch (error) {
        onRefusal(
          isRpcDeliveryUnknown(error) || isLogicalClientCutoverError(error)
            ? 'Response delivery unconfirmed'
            : error instanceof Error
              ? error.message
              : 'Request was not sent'
        )
        return null
      }
      if (!response.ok) {
        throw new Error(response.error.message)
      }
      const result = response.result as AgentSessionMutationResult<TValue>
      if (!result.ok) {
        onRefusal(result.refusal.message)
        return null
      }
      operationIdsRef.current.delete(mutationKey)
      onRefusal(null)
      return result.value
    },
    [client, fence, onRefusal, sessionId]
  )

  return useMemo(
    () => ({
      respondToPrompt: async (item: MobileStructuredPromptItem, optionId: string) =>
        Boolean(
          await mutate<AgentSessionPromptResult>(
            item.body.kind === 'approval'
              ? 'agentSession.respondToApproval'
              : 'agentSession.respondToQuestion',
            `agentSession.respondTo:${item.body.kind}`,
            { itemId: item.itemId, expectedRevision: item.revision, optionId }
          )
        ),
      setOption: async (key: string, value: string) =>
        Boolean(await mutate('agentSession.setOption', 'agentSession.setOption', { key, value })),
      cancel: async (turnId: string) =>
        Boolean(await mutate('agentSession.cancel', 'agentSession.cancel', { turnId }))
    }),
    [mutate]
  )
}
