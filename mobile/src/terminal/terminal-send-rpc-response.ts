import type { RpcResponse } from '../transport/types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isTerminalSendRpcAccepted(response: RpcResponse): boolean {
  if (!response.ok) {
    return false
  }
  if (!isRecord(response.result) || !isRecord(response.result.send)) {
    return false
  }
  return response.result.send.accepted === true
}

export function getTerminalSendRpcRefusedReason(response: RpcResponse): string | null {
  if (!response.ok || !isRecord(response.result) || !isRecord(response.result.send)) {
    return null
  }
  return typeof response.result.send.refusedReason === 'string'
    ? response.result.send.refusedReason
    : null
}
