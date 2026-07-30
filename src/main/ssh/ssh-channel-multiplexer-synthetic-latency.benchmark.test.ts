import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAIN_THREAD_DIAGNOSTICS_ENV,
  drainRemoteRpcRequestStats
} from '../diagnostics/main-thread-churn-probe'
import { SshChannelMultiplexer, type MultiplexerTransport } from './ssh-channel-multiplexer'
import { encodeFrame, MessageType } from './relay-protocol'

function responseFrame(
  id: number,
  seq: number,
  result?: unknown,
  error?: { code: number; message: string }
): Buffer {
  return encodeFrame(
    MessageType.Regular,
    seq,
    0,
    Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, ...(error ? { error } : { result }) }))
  )
}

function createTransport(): MultiplexerTransport & { receive: (data: Buffer) => void } {
  let receive = (_data: Buffer): void => {}
  return {
    write: () => {},
    onData: (callback) => {
      receive = callback
    },
    onClose: () => {},
    receive: (data) => receive(data)
  }
}

describe('synthetic slow-SSH RPC benchmark', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubEnv(MAIN_THREAD_DIAGNOSTICS_ENV, '1')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    drainRemoteRpcRequestStats()
  })

  it('reports controlled latency and counts each outcome once', async () => {
    const syntheticLatencyMs = 125
    const transport = createTransport()
    const mux = new SshChannelMultiplexer(transport)
    const abortController = new AbortController()
    const startedAt = Date.now()

    const success = mux.request('git.status')
    const remoteError = mux.request('git.history')
    const cancellation = mux.request('git.diff', {}, { signal: abortController.signal })
    const preAbortedController = new AbortController()
    preAbortedController.abort()
    const preAborted = mux.request('git.status', {}, { signal: preAbortedController.signal })
    const outcomesPromise = Promise.allSettled([success, remoteError, cancellation, preAborted])

    setTimeout(() => {
      transport.receive(responseFrame(1, 1, { entries: [] }))
      transport.receive(responseFrame(2, 2, undefined, { code: -32_000, message: 'synthetic' }))
      abortController.abort()
    }, syntheticLatencyMs)

    await vi.advanceTimersByTimeAsync(syntheticLatencyMs)
    const outcomes = await outcomesPromise
    const rpcs = drainRemoteRpcRequestStats()
    const report = {
      mode: 'synthetic-ssh-rpc-latency',
      latencyKind: 'controlled-in-memory-transport',
      syntheticLatencyMs,
      elapsedMs: Date.now() - startedAt,
      rpcCount: Object.values(rpcs).reduce((sum, stats) => sum + stats.count, 0),
      rpcs
    }

    console.info(`[synthetic-ssh-rpc] ${JSON.stringify(report)}`)
    expect(outcomes.map((outcome) => outcome.status)).toEqual([
      'fulfilled',
      'rejected',
      'rejected',
      'rejected'
    ])
    expect(report).toEqual({
      mode: 'synthetic-ssh-rpc-latency',
      latencyKind: 'controlled-in-memory-transport',
      syntheticLatencyMs: 125,
      elapsedMs: 125,
      rpcCount: 3,
      rpcs: {
        'git.status': { count: 1 },
        'git.history': { count: 1 },
        'git.diff': { count: 1 }
      }
    })

    mux.dispose()
  })

  it('counts a failed send attempt but not a disposed request', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const transport = createTransport()
    transport.write = () => {
      throw new Error('synthetic write failure')
    }
    const mux = new SshChannelMultiplexer(transport)

    await expect(mux.request('git.status')).rejects.toThrow('SSH connection lost')
    expect(drainRemoteRpcRequestStats()).toEqual({ 'git.status': { count: 1 } })

    mux.dispose()
    await expect(mux.request('git.status')).rejects.toThrow('Multiplexer disposed')
    expect(drainRemoteRpcRequestStats()).toEqual({})
  })
})
