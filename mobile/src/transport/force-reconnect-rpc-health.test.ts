import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient, SendRequestOptions } from './rpc-client'
import type { ConnectionState, RpcResponse } from './types'
import { verifyForceReconnectRpcHealth } from './force-reconnect-rpc-health'
import { markRpcDeliveryUnknown } from './rpc-delivery-ambiguity'
import { LogicalClientCutoverError } from './stable-logical-rpc-client'
import { RpcApplicationResponsiveness } from './rpc-application-responsiveness'

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
    const client = { sendRequest, getState: () => 'connected' as const } as unknown as RpcClient
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

  it('waits through a transient authorization retry', async () => {
    let state: ConnectionState = 'connecting'
    const sendRequest = vi.fn<() => Promise<RpcResponse>>()
    sendRequest
      .mockImplementationOnce(async () => {
        state = 'reconnecting'
        throw new Error('Unauthorized — pairing may be revoked')
      })
      .mockImplementationOnce(async () => {
        state = 'connected'
        return { id: 'rpc-1', ok: true, result: {} }
      })
    const client = { sendRequest, getState: () => state } as unknown as RpcClient

    await expect(verifyForceReconnectRpcHealth(client)).resolves.toBeUndefined()

    expect(sendRequest).toHaveBeenCalledTimes(2)
  })

  it('rejects a successful probe until a real application response clears the shared latch', async () => {
    const responsiveness = new RpcApplicationResponsiveness()
    responsiveness.recordTimeout('browser.screenshot', 123)
    const sendRequest = vi.fn(async () => ({ id: 'rpc-1', ok: true, result: {} }) as RpcResponse)
    const client = {
      sendRequest,
      getState: () => 'connected' as const,
      getRpcUnresponsiveSince: () => responsiveness.getUnresponsiveSince()
    } as unknown as RpcClient

    await expect(verifyForceReconnectRpcHealth(client)).rejects.toThrow(
      'Application RPC channel is still not responding'
    )
    responsiveness.recordResponse('worktree.list')
    await expect(verifyForceReconnectRpcHealth(client)).resolves.toBeUndefined()
    expect(sendRequest).toHaveBeenCalledTimes(2)
  })

  it('fails when authorization retries reach auth-failed', async () => {
    const sendRequest = vi.fn(async () => {
      throw new Error('Unauthorized — pairing may be revoked')
    })
    const client = {
      sendRequest,
      getState: () => 'auth-failed' as const
    } as unknown as RpcClient

    await expect(verifyForceReconnectRpcHealth(client)).rejects.toThrow(
      'Unauthorized — pairing may be revoked'
    )
    expect(sendRequest).toHaveBeenCalledOnce()
  })

  it('waits for a Relay replacement after the active session drops', async () => {
    let state: ConnectionState = 'connected'
    const listeners = new Set<(next: ConnectionState) => void>()
    const sendRequest = vi
      .fn<() => Promise<RpcResponse>>()
      .mockImplementationOnce(async () => {
        state = 'disconnected'
        throw markRpcDeliveryUnknown(new Error('relay RPC interrupted'))
      })
      .mockResolvedValueOnce({ id: 'rpc-2', ok: true, result: {} })
    const client = {
      sendRequest,
      getState: () => state,
      onStateChange: (listener: (next: ConnectionState) => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }
    } as unknown as RpcClient

    const verification = verifyForceReconnectRpcHealth(client)
    await vi.waitFor(() => expect(listeners.size).toBe(1))
    state = 'connected'
    for (const listener of listeners) {
      listener(state)
    }

    await expect(verification).resolves.toBeUndefined()
    expect(sendRequest).toHaveBeenCalledTimes(2)
  })
})
