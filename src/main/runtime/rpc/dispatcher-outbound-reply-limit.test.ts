import { describe, expect, it, vi } from 'vitest'
import {
  JsonStringifyByteLimitError,
  stringifyJsonWithinByteLimit
} from '../../../shared/node-bounded-json-stringify'
import { REMOTE_RUNTIME_MAX_OUTBOUND_JSON_BYTES } from '../../../shared/remote-runtime-memory-limits'
import type { OrcaRuntimeService } from '../orca-runtime'
import { defineMethod, defineStreamingMethod, type RpcRequest } from './core'
import { RpcDispatcher } from './dispatcher'

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
    expect(onOutboundReplyOverflow).toHaveBeenCalledOnce()
  })

  it('rejects an oversized error response without serializing a replacement reply', async () => {
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
      signal: abortController.signal,
      suppressRepliesAfterAbort: true
    })
    abortController.abort()
    lateEmit!({ toJSON })

    expect(toJSON).not.toHaveBeenCalled()
    expect(replies).toEqual([])
    expect(onOutboundReplyOverflow).not.toHaveBeenCalled()
  })

  it.each([
    [
      'a caller-created byte-limit error',
      () => {
        throw new JsonStringifyByteLimitError(2, 1)
      }
    ],
    ['a nested bounded-stringify error', () => stringifyJsonWithinByteLimit('nested', 1)]
  ])('preserves the small runtime error for %s', async (_label, throwFromToJSON) => {
    const replies: string[] = []
    const onOutboundReplyOverflow = vi.fn()
    const dispatcher = new RpcDispatcher({
      runtime: stubRuntime(),
      methods: [
        defineMethod({
          name: REQUEST.method,
          params: null,
          handler: async () => ({ toJSON: throwFromToJSON })
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

  it('does not read Symbol.toStringTag beyond native JSON behavior', async () => {
    const replies: string[] = []
    const readToStringTag = vi.fn(() => {
      throw new Error('unexpected Symbol.toStringTag read')
    })
    const result = {
      value: 1,
      get [Symbol.toStringTag]() {
        return readToStringTag()
      }
    }
    const dispatcher = new RpcDispatcher({
      runtime: stubRuntime(),
      methods: [
        defineMethod({
          name: REQUEST.method,
          params: null,
          handler: async () => result
        })
      ]
    })

    await dispatcher.dispatchStreaming(REQUEST, (reply) => replies.push(reply), {
      onOutboundReplyOverflow: vi.fn()
    })

    expect(readToStringTag).not.toHaveBeenCalled()
    expect(JSON.parse(replies[0]!)).toMatchObject({ ok: true, result: { value: 1 } })
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
