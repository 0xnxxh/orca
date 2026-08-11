import { EventEmitter } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { WebSocket } from 'ws'

const { trackMock } = vi.hoisted(() => ({ trackMock: vi.fn() }))

vi.mock('../telemetry/client', () => ({ track: trackMock }))

import { DeviceRegistry } from './device-registry'
import type { OrcaRuntimeService } from './orca-runtime'
import type { RpcDispatchStreamingOptions } from './rpc/dispatcher-stream-options'
import { OrcaRuntimeRpcServer } from './runtime-rpc'

class FakeWebSocket extends EventEmitter {
  readonly OPEN = 1
  readyState = this.OPEN
}

describe('runtime RPC outbound overflow', () => {
  it('aborts the active dispatch before closing its E2EE channel', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'orca-runtime-rpc-overflow-'))
    const runtime = { getRuntimeId: () => 'test-runtime' } as OrcaRuntimeService
    const server = new OrcaRuntimeRpcServer({ runtime, userDataPath, enableWebSocket: false })
    const registry = new DeviceRegistry(userDataPath)
    const device = registry.addDevice('runtime-test', 'runtime')
    const ws = new FakeWebSocket()
    const closeForOutboundReplyOverflow = vi.fn()
    server['deviceRegistry'] = registry
    server['mobileSocketWiring'] = {
      closeForOutboundReplyOverflow,
      getConnectionId: () => 'connection-1'
    } as unknown as NonNullable<(typeof server)['mobileSocketWiring']>
    let dispatchSignal: AbortSignal | undefined
    ;(
      server as unknown as {
        dispatcher: {
          dispatchStreaming: (
            request: unknown,
            reply: (response: string) => void,
            options?: RpcDispatchStreamingOptions
          ) => Promise<void>
        }
      }
    ).dispatcher = {
      dispatchStreaming: vi.fn(async (_request, _reply, options) => {
        dispatchSignal = options?.signal
        expect(dispatchSignal?.aborted).toBe(false)
        options?.onOutboundReplyOverflow?.({ method: 'status.get' })
        expect(dispatchSignal?.aborted).toBe(true)
      })
    }

    try {
      await server['handleWebSocketMessage'](
        JSON.stringify({
          id: 'request-1',
          method: 'status.get',
          deviceToken: device.token
        }),
        vi.fn(),
        vi.fn(),
        undefined,
        ws as unknown as WebSocket
      )

      expect(dispatchSignal?.aborted).toBe(true)
      expect(closeForOutboundReplyOverflow).toHaveBeenCalledOnce()
      expect(closeForOutboundReplyOverflow).toHaveBeenCalledWith(ws)
      expect(ws.listenerCount('close')).toBe(0)
      expect(ws.listenerCount('error')).toBe(0)
      expect(trackMock.mock.calls.filter(([event]) => event === 'remote_reply_overflow')).toEqual([
        [
          'remote_reply_overflow',
          { method: 'status.get', transport: 'direct', client_kind: 'runtime' }
        ]
      ])
    } finally {
      await server.stop()
      await rm(userDataPath, { recursive: true, force: true })
    }
  })
})
