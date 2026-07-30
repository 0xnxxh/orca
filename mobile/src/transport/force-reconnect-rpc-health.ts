import type { RpcClient } from './rpc-client'

const FORCE_RECONNECT_HEALTH_TIMEOUT_MS = 15_000

export async function verifyForceReconnectRpcHealth(client: RpcClient): Promise<void> {
  await client
    .sendRequest('status.get', undefined, { timeoutMs: FORCE_RECONNECT_HEALTH_TIMEOUT_MS })
    .catch(() => undefined)
}
