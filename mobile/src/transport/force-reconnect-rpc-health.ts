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
      if (client.getRpcUnresponsiveSince?.() != null) {
        throw new Error('Application RPC channel is still not responding')
      }
      return
    } catch (error) {
      const state = client.getState()
      if (state === 'auth-failed' || !isRecoverableHealthError(error, state)) {
        throw error
      }
      lastError = error
      if (state === 'disconnected') {
        await waitForReconnectState(client, deadline, error)
      }
    }
  }
}

function isRecoverableHealthError(
  error: unknown,
  state: ReturnType<RpcClient['getState']>
): boolean {
  return (
    state === 'reconnecting' ||
    isLogicalClientCutoverError(error) ||
    isRpcDeliveryUnknown(error) ||
    (error instanceof Error &&
      ['Connection interrupted', 'relay session not connected'].includes(error.message))
  )
}

function waitForReconnectState(
  client: RpcClient,
  deadline: number,
  lastError: unknown
): Promise<void> {
  if (client.getState() !== 'disconnected') {
    return Promise.resolve()
  }
  return new Promise((resolve, reject) => {
    const timeoutMs = deadline - Date.now()
    if (timeoutMs <= 0) {
      reject(lastError)
      return
    }
    const timer = setTimeout(() => finish(() => reject(lastError)), timeoutMs)
    const unsubscribe = client.onStateChange((state) => {
      if (state === 'disconnected') {
        return
      }
      finish(state === 'auth-failed' ? () => reject(lastError) : resolve)
    })
    const currentState = client.getState()
    if (currentState !== 'disconnected') {
      finish(currentState === 'auth-failed' ? () => reject(lastError) : resolve)
    }

    function finish(settle: () => void): void {
      clearTimeout(timer)
      unsubscribe()
      settle()
    }
  })
}
