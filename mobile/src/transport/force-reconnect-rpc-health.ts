import type { RpcClient } from './rpc-client'
import { isRpcDeliveryUnknown } from './rpc-delivery-ambiguity'
import { isLogicalClientCutoverError } from './stable-logical-rpc-client'

export const FORCE_RECONNECT_TIMEOUT_MS = 15_000

export async function verifyForceReconnectRpcHealth(
  client: RpcClient,
  deadline = Date.now() + FORCE_RECONNECT_TIMEOUT_MS
): Promise<void> {
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
        client.getState() !== 'reconnecting' &&
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
