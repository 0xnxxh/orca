import type { RpcClient } from './rpc-client'
import { isRpcDeliveryUnknown } from './rpc-delivery-ambiguity'
import { isLogicalClientCutoverError } from './stable-logical-rpc-client'

const FORCE_RECONNECT_HEALTH_TIMEOUT_MS = 15_000

export async function verifyForceReconnectRpcHealth(client: RpcClient): Promise<void> {
  const deadline = Date.now() + FORCE_RECONNECT_HEALTH_TIMEOUT_MS
  let lastError: unknown = null
  for (;;) {
    const timeoutMs = deadline - Date.now()
    if (timeoutMs <= 0) {
      throw lastError ?? new Error('Force Reconnect health check timed out')
    }
    try {
      await client.sendRequest('status.get', undefined, {
        timeoutMs,
        budgetSpansConnect: true,
        strictDeadline: true
      })
      return
    } catch (error) {
      if (
        !isLogicalClientCutoverError(error) &&
        !isRpcDeliveryUnknown(error) &&
        !(error instanceof Error && error.message === 'Connection interrupted')
      ) {
        throw error
      }
      lastError = error
    }
  }
}
