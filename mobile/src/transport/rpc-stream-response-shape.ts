import type { RpcResponse, RpcSuccess } from './types'

export function isTerminalSubscribedResult(
  value: unknown
): value is { type: 'subscribed'; streamId: number } {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { type?: unknown }).type === 'subscribed' &&
    typeof (value as { streamId?: unknown }).streamId === 'number'
  )
}

export function isStreamingSubscriptionReadyResult(
  value: unknown
): value is { type: 'ready'; subscriptionId: string } {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { type?: unknown }).type === 'ready' &&
    typeof (value as { subscriptionId?: unknown }).subscriptionId === 'string'
  )
}

export function isStreamControlResponse(response: RpcResponse): boolean {
  if (!response.ok) {
    return true
  }
  const result = (response as RpcSuccess).result
  if (!result || typeof result !== 'object') {
    return false
  }
  const metadata = result as {
    type?: unknown
    subscriptionId?: unknown
    streamId?: unknown
  }
  return (
    metadata.type === 'end' ||
    metadata.type === 'error' ||
    typeof metadata.subscriptionId === 'string' ||
    typeof metadata.streamId === 'number'
  )
}
