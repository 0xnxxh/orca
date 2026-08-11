import { describe, expect, it, vi } from 'vitest'
import { REMOTE_RUNTIME_MAX_OUTBOUND_JSON_BYTES } from '../../../shared/remote-runtime-capacity-limits'
import type { OrcaRuntimeService } from '../orca-runtime'
import { defineMethod, defineStreamingMethod, type RpcRequest } from './core'
import { RpcDispatcher } from './dispatcher'
// Test-only: pins the dispatcher pre-filter to the channel admission it must never disagree with.
import { isMobileE2EETextPayloadWithinLimit } from './mobile-e2ee-outbound-admission'

const REQUEST: RpcRequest = {
  id: 'req-1',
  authToken: 'token',
  method: 'test.reply-limit'
}

function stubRuntime(): OrcaRuntimeService {
  return { getRuntimeId: () => 'test-runtime' } as OrcaRuntimeService
}

function asciiResultForEnvelopeBytes(bytes: number): string {
  const emptyEnvelope = JSON.stringify({
    id: REQUEST.id,
    ok: true,
    result: '',
    _meta: { runtimeId: 'test-runtime' }
  })
  return 'x'.repeat(bytes - Buffer.byteLength(emptyEnvelope))
}

describe('RpcDispatcher outbound reply limit', () => {
  it('admits a one-shot response at the exact serialized envelope limit', async () => {
    const replies: string[] = []
    const onOutboundReplyOverflow = vi.fn()
    const dispatcher = new RpcDispatcher({
      runtime: stubRuntime(),
      methods: [
        defineMethod({
          name: REQUEST.method,
          params: null,
          handler: async () => asciiResultForEnvelopeBytes(REMOTE_RUNTIME_MAX_OUTBOUND_JSON_BYTES)
        })
      ]
    })

    await dispatcher.dispatchStreaming(REQUEST, (reply) => replies.push(reply), {
      onOutboundReplyOverflow
    })

    expect(replies).toHaveLength(1)
    expect(Buffer.byteLength(replies[0]!, 'utf8')).toBe(REMOTE_RUNTIME_MAX_OUTBOUND_JSON_BYTES)
    expect(onOutboundReplyOverflow).not.toHaveBeenCalled()
  })

  it('rejects a one-shot response one byte above the serialized envelope limit', async () => {
    const replies: string[] = []
    const onOutboundReplyOverflow = vi.fn()
    const dispatcher = new RpcDispatcher({
      runtime: stubRuntime(),
      methods: [
        defineMethod({
          name: REQUEST.method,
          params: null,
          handler: async () =>
            asciiResultForEnvelopeBytes(REMOTE_RUNTIME_MAX_OUTBOUND_JSON_BYTES + 1)
        })
      ]
    })

    await dispatcher.dispatchStreaming(REQUEST, (reply) => replies.push(reply), {
      onOutboundReplyOverflow
    })

    expect(replies).toEqual([])
    expect(onOutboundReplyOverflow).toHaveBeenCalledExactlyOnceWith({ method: REQUEST.method })
  })

  it('reports an unregistered method as "unknown" so a client string cannot reach telemetry', async () => {
    const onOutboundReplyOverflow = vi.fn()
    const dispatcher = new RpcDispatcher({ runtime: stubRuntime(), methods: [] })

    await dispatcher.dispatchStreaming(
      { ...REQUEST, method: 'x'.repeat(REMOTE_RUNTIME_MAX_OUTBOUND_JSON_BYTES) },
      vi.fn(),
      { onOutboundReplyOverflow }
    )

    expect(onOutboundReplyOverflow).toHaveBeenCalledExactlyOnceWith({ method: 'unknown' })
  })

  it('rejects an oversized error response without emitting a replacement reply', async () => {
    const replies: string[] = []
    const onOutboundReplyOverflow = vi.fn()
    const dispatcher = new RpcDispatcher({
      runtime: stubRuntime(),
      methods: [
        defineMethod({
          name: REQUEST.method,
          params: null,
          handler: async () => {
            throw new Error('x'.repeat(REMOTE_RUNTIME_MAX_OUTBOUND_JSON_BYTES))
          }
        })
      ]
    })

    await dispatcher.dispatchStreaming(REQUEST, (reply) => replies.push(reply), {
      onOutboundReplyOverflow
    })

    expect(replies).toEqual([])
    expect(onOutboundReplyOverflow).toHaveBeenCalledOnce()
  })

  it('closes a synchronous stream once and suppresses later emits after overflow', async () => {
    const replies: string[] = []
    const onOutboundReplyOverflow = vi.fn()
    const dispatcher = new RpcDispatcher({
      runtime: stubRuntime(),
      methods: [
        defineStreamingMethod({
          name: REQUEST.method,
          params: null,
          handler: async (_params, _context, emit) => {
            emit({ chunk: 'x'.repeat(REMOTE_RUNTIME_MAX_OUTBOUND_JSON_BYTES) })
            emit({ chunk: 'suppressed' })
          }
        })
      ]
    })

    await dispatcher.dispatchStreaming(REQUEST, (reply) => replies.push(reply), {
      onOutboundReplyOverflow
    })

    expect(replies).toEqual([])
    expect(onOutboundReplyOverflow).toHaveBeenCalledOnce()
  })

  it('does not throw or repeat cleanup for late stream emits after overflow', async () => {
    const replies: string[] = []
    const onOutboundReplyOverflow = vi.fn()
    let lateEmit: ((result: unknown) => void) | undefined
    const dispatcher = new RpcDispatcher({
      runtime: stubRuntime(),
      methods: [
        defineStreamingMethod({
          name: REQUEST.method,
          params: null,
          handler: async (_params, _context, emit) => {
            lateEmit = emit
          }
        })
      ]
    })

    await dispatcher.dispatchStreaming(REQUEST, (reply) => replies.push(reply), {
      onOutboundReplyOverflow
    })

    expect(() => {
      lateEmit!({ chunk: 'x'.repeat(REMOTE_RUNTIME_MAX_OUTBOUND_JSON_BYTES) })
      lateEmit!({ chunk: 'suppressed' })
    }).not.toThrow()
    expect(replies).toEqual([])
    expect(onOutboundReplyOverflow).toHaveBeenCalledOnce()
  })

  it('suppresses late stream serialization after the request is aborted', async () => {
    const replies: string[] = []
    const onOutboundReplyOverflow = vi.fn()
    const abortController = new AbortController()
    const toJSON = vi.fn(() => ({ chunk: 'should-not-serialize' }))
    let lateEmit: ((result: unknown) => void) | undefined
    const dispatcher = new RpcDispatcher({
      runtime: stubRuntime(),
      methods: [
        defineStreamingMethod({
          name: REQUEST.method,
          params: null,
          handler: async (_params, _context, emit) => {
            lateEmit = emit
          }
        })
      ]
    })

    await dispatcher.dispatchStreaming(REQUEST, (reply) => replies.push(reply), {
      onOutboundReplyOverflow,
      shouldSuppressReplies: () => abortController.signal.aborted
    })
    abortController.abort()
    lateEmit!({ toJSON })

    expect(toJSON).not.toHaveBeenCalled()
    expect(replies).toEqual([])
    expect(onOutboundReplyOverflow).not.toHaveBeenCalled()
  })

  it('maps a toJSON throw to a small runtime_error reply', async () => {
    const replies: string[] = []
    const onOutboundReplyOverflow = vi.fn()
    const dispatcher = new RpcDispatcher({
      runtime: stubRuntime(),
      methods: [
        defineMethod({
          name: REQUEST.method,
          params: null,
          handler: async () => ({
            toJSON: () => {
              throw new Error('toJSON failed')
            }
          })
        })
      ]
    })

    await dispatcher.dispatchStreaming(REQUEST, (reply) => replies.push(reply), {
      onOutboundReplyOverflow
    })

    expect(replies).toHaveLength(1)
    expect(JSON.parse(replies[0]!)).toMatchObject({
      ok: false,
      error: { code: 'runtime_error' }
    })
    expect(onOutboundReplyOverflow).not.toHaveBeenCalled()
  })

  it('measures UTF-8 bytes, not string length', async () => {
    const replies: string[] = []
    const onOutboundReplyOverflow = vi.fn()
    // 3 UTF-8 bytes each, so `.length` stays far below the limit the byte count blows past.
    const result = '€'.repeat(2 * 1024 * 1024)
    const dispatcher = new RpcDispatcher({
      runtime: stubRuntime(),
      methods: [defineMethod({ name: REQUEST.method, params: null, handler: async () => result })]
    })

    expect(result.length).toBeLessThan(REMOTE_RUNTIME_MAX_OUTBOUND_JSON_BYTES)
    await dispatcher.dispatchStreaming(REQUEST, (reply) => replies.push(reply), {
      onOutboundReplyOverflow
    })

    expect(replies).toEqual([])
    expect(onOutboundReplyOverflow).toHaveBeenCalledOnce()
  })

  it('agrees with the E2EE channel admission at the byte boundary', async () => {
    const replies: string[] = []
    const rejected: string[] = []
    const dispatcher = (bytes: number): RpcDispatcher =>
      new RpcDispatcher({
        runtime: stubRuntime(),
        methods: [
          defineMethod({
            name: REQUEST.method,
            params: null,
            handler: async () => asciiResultForEnvelopeBytes(bytes)
          })
        ]
      })

    await dispatcher(REMOTE_RUNTIME_MAX_OUTBOUND_JSON_BYTES).dispatchStreaming(
      REQUEST,
      (reply) => replies.push(reply),
      { onOutboundReplyOverflow: vi.fn() }
    )
    await dispatcher(REMOTE_RUNTIME_MAX_OUTBOUND_JSON_BYTES + 1).dispatchStreaming(
      REQUEST,
      (reply) => replies.push(reply),
      { onOutboundReplyOverflow: () => rejected.push('overflow') }
    )

    expect(isMobileE2EETextPayloadWithinLimit(replies[0]!)).toBe(true)
    expect(rejected).toHaveLength(1)
    expect(
      isMobileE2EETextPayloadWithinLimit(
        JSON.stringify({
          id: REQUEST.id,
          ok: true,
          result: asciiResultForEnvelopeBytes(REMOTE_RUNTIME_MAX_OUTBOUND_JSON_BYTES + 1),
          _meta: { runtimeId: 'test-runtime' }
        })
      )
    ).toBe(false)
  })

  it('still replies when the reply channel is open', async () => {
    const replies: string[] = []
    const abortController = new AbortController()
    abortController.abort()
    const dispatcher = new RpcDispatcher({
      runtime: stubRuntime(),
      methods: [
        defineMethod({ name: REQUEST.method, params: null, handler: async () => ({ ok: true }) })
      ]
    })

    await dispatcher.dispatchStreaming(REQUEST, (reply) => replies.push(reply), {
      onOutboundReplyOverflow: vi.fn(),
      signal: abortController.signal,
      shouldSuppressReplies: () => false
    })

    expect(replies).toHaveLength(1)
    expect(JSON.parse(replies[0]!)).toMatchObject({ ok: true, result: { ok: true } })
  })

  it('records the streaming feature interaction even when replies are suppressed', async () => {
    const recordFeatureInteraction = vi.fn()
    const replies: string[] = []
    const dispatcher = new RpcDispatcher({
      runtime: {
        getRuntimeId: () => 'test-runtime',
        recordFeatureInteraction
      } as unknown as OrcaRuntimeService,
      methods: [
        defineStreamingMethod({
          name: 'orchestration.stream-test',
          params: null,
          handler: async (_params, _context, emit) => {
            emit({ chunk: 'suppressed' })
          }
        })
      ]
    })

    await dispatcher.dispatchStreaming(
      { ...REQUEST, method: 'orchestration.stream-test' },
      (reply) => replies.push(reply),
      { shouldSuppressReplies: () => true }
    )

    expect(recordFeatureInteraction).toHaveBeenCalledWith('agent-orchestration')
    expect(replies).toEqual([])
  })

  it('preserves the existing small error reply for non-size serialization failures', async () => {
    const replies: string[] = []
    const onOutboundReplyOverflow = vi.fn()
    const circular: Record<string, unknown> = {}
    circular.self = circular
    const dispatcher = new RpcDispatcher({
      runtime: stubRuntime(),
      methods: [
        defineMethod({
          name: REQUEST.method,
          params: null,
          handler: async () => circular
        })
      ]
    })

    await dispatcher.dispatchStreaming(REQUEST, (reply) => replies.push(reply), {
      onOutboundReplyOverflow
    })

    expect(replies).toHaveLength(1)
    expect(JSON.parse(replies[0]!)).toMatchObject({
      ok: false,
      error: { code: 'runtime_error' }
    })
    expect(onOutboundReplyOverflow).not.toHaveBeenCalled()
  })
})
