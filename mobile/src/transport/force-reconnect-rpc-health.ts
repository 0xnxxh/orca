import type { RpcClient } from './rpc-client'
import { isLogicalClientCutoverError } from './stable-logical-rpc-client'

const FORCE_RECONNECT_HEALTH_TIMEOUT_MS = 15_000

export async function verifyForceReconnectRpcHealth(client: RpcClient): Promise<void> {
  const deadline = Date.now() + FORCE_RECONNECT_HEALTH_TIMEOUT_MS
  let lastCutover: unknown = null
  for (;;) {
    const timeoutMs = deadline - Date.now()
    if (timeoutMs <= 0) {
      throw lastCutover ?? new Error('Force Reconnect health check timed out')
    }
    try {
      await client.sendRequest('status.get', undefined, { timeoutMs, budgetSpansConnect: true })
      return
    } catch (error) {
      if (!isLogicalClientCutoverError(error)) {
        throw error
      }
      lastCutover = error
    }
  }
}
