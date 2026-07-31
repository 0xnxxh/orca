import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient, SendRequestOptions } from './rpc-client'
import { verifyForceReconnectRpcHealth } from './force-reconnect-rpc-health'
import { LogicalClientCutoverError } from './stable-logical-rpc-client'

describe('Force Reconnect RPC health', () => {
  afterEach(() => vi.useRealTimers())

  it('spends one 15-second budget across a cutover and the replacement probe', async () => {
    vi.useFakeTimers()
    let attempt = 0
    const timeouts: number[] = []
    const sendRequest = vi.fn(
      (_method: string, _params?: unknown, options?: SendRequestOptions): Promise<never> => {
        const timeoutMs = options?.timeoutMs ?? 0
        timeouts.push(timeoutMs)
        const currentAttempt = ++attempt
        return new Promise((_, reject) => {
          setTimeout(
            () =>
              reject(currentAttempt === 1 ? new LogicalClientCutoverError() : new Error('stalled')),
            currentAttempt === 1 ? 14_000 : timeoutMs
          )
        })
      }
    )
    const client = { sendRequest } as unknown as RpcClient
    let outcome = 'pending'
    const verification = verifyForceReconnectRpcHealth(client).catch((error: Error) => {
      outcome = error.message
    })

    await vi.advanceTimersByTimeAsync(14_999)
    expect(outcome).toBe('pending')
    expect(timeouts).toEqual([15_000, 1_000])
    await vi.advanceTimersByTimeAsync(1)
    await verification

    expect(outcome).toBe('stalled')
    expect(sendRequest).toHaveBeenCalledTimes(2)
    expect(sendRequest).toHaveBeenLastCalledWith('status.get', undefined, {
      timeoutMs: 1_000,
      budgetSpansConnect: true,
      strictDeadline: true
    })
  })
})
