import { createElement, useLayoutEffect } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { RpcClient } from '../transport/rpc-client'
import {
  useMobileNativeChatSession,
  type MobileNativeChatSession
} from './use-mobile-native-chat-session'

/** Hands a pending `sendRequest` promise's settlers to the test body. */
type PageSettle = { resolve: (response: unknown) => void; reject: (reason: unknown) => void }

function message(id: string): NativeChatMessage {
  return {
    id,
    role: 'assistant',
    blocks: [{ type: 'text', text: id }],
    timestamp: 1,
    source: 'transcript'
  }
}

describe('useMobileNativeChatSession', () => {
  let renderer: ReactTestRenderer | null = null
  let state: MobileNativeChatSession | null = null
  let emit: (frame: unknown) => void = () => {}
  const renderedLoadEarlierErrors: Array<string | null> = []

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    state = null
    renderedLoadEarlierErrors.length = 0
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function Harness({
    client,
    agent = 'claude',
    transcriptPath = null,
    onLayout
  }: {
    client: RpcClient | null
    agent?: string | null
    transcriptPath?: string | null
    onLayout?: () => void
  }): null {
    state = useMobileNativeChatSession({
      client,
      agent,
      sessionId: 'session',
      transcriptPath
    })
    renderedLoadEarlierErrors.push(state.loadEarlierError)
    useLayoutEffect(() => onLayout?.(), [onLayout])
    return null
  }

  async function mount(
    client: RpcClient,
    options: { agent?: string | null; transcriptPath?: string | null } = {}
  ): Promise<void> {
    const original = console.error
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      if (typeof args[0] === 'string' && args[0].includes('react-test-renderer is deprecated')) {
        return
      }
      original(...args)
    })
    try {
      await act(async () => {
        renderer = create(createElement(Harness, { client, ...options }))
      })
    } finally {
      consoleSpy.mockRestore()
    }
  }

  it('drops an older-page response captured before transcript replacement', async () => {
    let resolveEarlier: (response: unknown) => void = () => {}
    const sendRequest = vi.fn(
      () => new Promise((resolve) => (resolveEarlier = resolve))
    ) as unknown as RpcClient['sendRequest']
    const subscribe: RpcClient['subscribe'] = vi.fn((_method, _params, onData) => {
      emit = onData
      onData({
        type: 'snapshot',
        messages: Array.from({ length: 40 }, (_unused, index) => message(`old-${index}`)),
        hasMore: true,
        beforeOffset: 100
      })
      return () => {}
    })
    await mount({ sendRequest, subscribe } as unknown as RpcClient)
    act(() => state?.loadEarlier())

    await act(async () => {
      emit({
        type: 'replacement',
        messages: [message('replacement')],
        hasMore: false,
        beforeOffset: 0
      })
    })
    await act(async () => {
      resolveEarlier({
        ok: true,
        result: { messages: [message('stale-page')], hasMore: false, beforeOffset: 0 }
      })
      await Promise.resolve()
    })

    expect(state?.messages.map((entry) => entry.id)).toEqual(['replacement'])
    expect(state?.loadingEarlier).toBe(false)
  })

  it('drops an older-page response after the client source disappears', async () => {
    let resolveEarlier: (response: unknown) => void = () => {}
    const sendRequest = vi.fn(
      () => new Promise((resolve) => (resolveEarlier = resolve))
    ) as unknown as RpcClient['sendRequest']
    const subscribe: RpcClient['subscribe'] = vi.fn((_method, _params, onData) => {
      onData({
        type: 'snapshot',
        messages: Array.from({ length: 40 }, (_unused, index) => message(`old-${index}`)),
        hasMore: true,
        beforeOffset: 100
      })
      return () => {}
    })
    await mount({ sendRequest, subscribe } as unknown as RpcClient)
    act(() => state?.loadEarlier())
    await act(async () => renderer?.update(createElement(Harness, { client: null })))
    await act(async () => {
      resolveEarlier({ ok: true, result: { messages: [message('stale-page')] } })
      await Promise.resolve()
    })

    expect(state?.messages).toEqual([])
    expect(state?.status).toBe('idle')
    expect(state?.loadingEarlier).toBe(false)
  })

  it('drops a page settled during a same-session transcript source change', async () => {
    const settle: PageSettle = { resolve: () => {}, reject: () => {} }
    const sendRequest = vi.fn(
      () =>
        new Promise((resolve, reject) => {
          settle.resolve = resolve
          settle.reject = reject
        })
    ) as unknown as RpcClient['sendRequest']
    const subscribe: RpcClient['subscribe'] = vi.fn((_method, _params, onData) => {
      onData({
        type: 'snapshot',
        messages: Array.from({ length: 40 }, (_unused, index) => message(`old-${index}`)),
        hasMore: true,
        beforeOffset: 100
      })
      return () => {}
    })
    const client = { sendRequest, subscribe } as unknown as RpcClient
    await mount(client, { transcriptPath: '/old/transcript.jsonl' })
    act(() => state?.loadEarlier())
    renderedLoadEarlierErrors.length = 0

    await act(async () => {
      renderer?.update(
        createElement(Harness, {
          client,
          transcriptPath: '/new/transcript.jsonl',
          onLayout: () => settle.resolve({ ok: false, error: 'offline' })
        })
      )
      await Promise.resolve()
    })

    expect(renderedLoadEarlierErrors).not.toContain('Couldn’t load earlier messages')
    expect(state?.loadEarlierError).toBeNull()
  })

  it.each(['replacement', 'snapshot'] as const)(
    'can page again after an authoritative %s resets a maxed-out read window',
    async (frameType) => {
      const sendRequest = vi.fn().mockResolvedValue({
        ok: true,
        result: { messages: [message('older')], hasMore: true, beforeOffset: 50 }
      })
      const subscribe: RpcClient['subscribe'] = vi.fn((_method, _params, onData) => {
        emit = onData
        onData({
          type: 'snapshot',
          messages: Array.from({ length: 40 }, (_unused, index) => message(`old-${index}`)),
          hasMore: true,
          beforeOffset: 100
        })
        return () => {}
      })
      await mount({ sendRequest, subscribe } as unknown as RpcClient)
      for (let page = 0; page < 33; page += 1) {
        await act(async () => {
          state?.loadEarlier()
          await Promise.resolve()
        })
      }
      const requestsAtCap = sendRequest.mock.calls.length

      await act(async () =>
        emit({
          type: frameType,
          messages: [message('authoritative')],
          hasMore: true,
          beforeOffset: 500
        })
      )
      await act(async () => {
        state?.loadEarlier()
        await Promise.resolve()
      })

      expect(sendRequest).toHaveBeenCalledTimes(requestsAtCap + 1)
      expect(sendRequest).toHaveBeenLastCalledWith('nativeChat.readSession', {
        agent: 'claude',
        sessionId: 'session',
        limit: 60,
        beforeOffset: 500
      })
    }
  )

  it('surfaces a failed older-history page and clears it on a retry', async () => {
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: 'offline' })
      .mockResolvedValueOnce({
        ok: true,
        result: { messages: [message('older')], hasMore: false, beforeOffset: 0 }
      })
    const subscribe: RpcClient['subscribe'] = vi.fn((_method, _params, onData) => {
      onData({
        type: 'snapshot',
        messages: Array.from({ length: 40 }, (_unused, index) => message(`window-${index}`)),
        hasMore: true,
        beforeOffset: 100
      })
      return () => {}
    })
    await mount({ sendRequest, subscribe } as unknown as RpcClient)

    await act(async () => {
      state?.loadEarlier()
      await Promise.resolve()
    })
    expect(state?.loadEarlierError).toBe('Couldn’t load earlier messages')
    expect(state?.loadingEarlier).toBe(false)
    // The failure must not consume the page budget — the retry asks for the same
    // cursor, not the one after it.
    expect(state?.hasMore).toBe(true)

    await act(async () => {
      state?.loadEarlier()
      await Promise.resolve()
    })
    expect(state?.loadEarlierError).toBeNull()
    expect(state?.messages.map((entry) => entry.id)[0]).toBe('older')
    expect(sendRequest.mock.calls[1]?.[1]).toEqual(sendRequest.mock.calls[0]?.[1])
  })

  it('surfaces an error result from an older-history page', async () => {
    const sendRequest = vi.fn().mockResolvedValue({ ok: true, result: { error: 'read failed' } })
    const subscribe: RpcClient['subscribe'] = vi.fn((_method, _params, onData) => {
      onData({
        type: 'snapshot',
        messages: Array.from({ length: 40 }, (_unused, index) => message(`window-${index}`)),
        hasMore: true,
        beforeOffset: 100
      })
      return () => {}
    })
    await mount({ sendRequest, subscribe } as unknown as RpcClient)

    await act(async () => {
      state?.loadEarlier()
      await Promise.resolve()
    })

    expect(state?.loadEarlierError).toBe('Couldn’t load earlier messages')
  })

  it('surfaces a rejected older-history request instead of leaking it', async () => {
    const sendRequest = vi.fn().mockRejectedValue(new Error('disconnected'))
    const subscribe: RpcClient['subscribe'] = vi.fn((_method, _params, onData) => {
      onData({
        type: 'snapshot',
        messages: Array.from({ length: 40 }, (_unused, index) => message(`window-${index}`)),
        hasMore: true,
        beforeOffset: 100
      })
      return () => {}
    })
    await mount({ sendRequest, subscribe } as unknown as RpcClient)

    await act(async () => {
      state?.loadEarlier()
      await Promise.resolve()
    })

    expect(state?.loadEarlierError).toBe('Couldn’t load earlier messages')
    expect(state?.loadingEarlier).toBe(false)
  })

  // Both stale-failure guards have to hold: a swapped-out page can fail by
  // rejecting or by resolving not-ok, and each has its own `requestIsCurrent()`.
  it.each([
    ['a rejected request', (settle: PageSettle) => settle.reject(new Error('disconnected'))],
    ['a not-ok response', (settle: PageSettle) => settle.resolve({ ok: false, error: 'offline' })]
  ])('drops %s from a page the session swapped out from under', async (_label, settleEarlier) => {
    const settle: PageSettle = { resolve: () => {}, reject: () => {} }
    const sendRequest = vi.fn(
      () =>
        new Promise((resolve, reject) => {
          settle.resolve = resolve
          settle.reject = reject
        })
    ) as unknown as RpcClient['sendRequest']
    const subscribe: RpcClient['subscribe'] = vi.fn((_method, _params, onData) => {
      emit = onData
      onData({
        type: 'snapshot',
        messages: Array.from({ length: 40 }, (_unused, index) => message(`window-${index}`)),
        hasMore: true,
        beforeOffset: 100
      })
      return () => {}
    })
    await mount({ sendRequest, subscribe } as unknown as RpcClient)
    act(() => state?.loadEarlier())

    await act(async () =>
      emit({ type: 'replacement', messages: [message('fresh')], hasMore: true, beforeOffset: 0 })
    )
    await act(async () => {
      settleEarlier(settle)
      await Promise.resolve()
    })

    // The fresh window already superseded that page; a stale failure must not
    // block paging on it.
    expect(state?.loadEarlierError).toBeNull()
  })

  it('clears a surfaced failure when an authoritative window replaces the transcript', async () => {
    const sendRequest = vi.fn().mockResolvedValue({ ok: false, error: 'offline' })
    const subscribe: RpcClient['subscribe'] = vi.fn((_method, _params, onData) => {
      emit = onData
      onData({
        type: 'snapshot',
        messages: Array.from({ length: 40 }, (_unused, index) => message(`window-${index}`)),
        hasMore: true,
        beforeOffset: 100
      })
      return () => {}
    })
    await mount({ sendRequest, subscribe } as unknown as RpcClient)
    await act(async () => {
      state?.loadEarlier()
      await Promise.resolve()
    })
    expect(state?.loadEarlierError).toBe('Couldn’t load earlier messages')

    await act(async () =>
      emit({ type: 'replacement', messages: [message('fresh')], hasMore: true, beforeOffset: 0 })
    )

    expect(state?.loadEarlierError).toBeNull()
  })

  it('rejects a cursor page invalidated by live trim and retries with a growing tail', async () => {
    let resolveCursorPage: (response: unknown) => void = () => {}
    const sendRequest = vi
      .fn()
      .mockImplementationOnce(() => new Promise((resolve) => (resolveCursorPage = resolve)))
      .mockResolvedValueOnce({
        ok: true,
        result: { messages: [message('fresh-growing-tail')], hasMore: false }
      })
    const subscribe: RpcClient['subscribe'] = vi.fn((_method, _params, onData) => {
      emit = onData
      onData({
        type: 'snapshot',
        messages: Array.from({ length: 40 }, (_unused, index) => message(`window-${index}`)),
        hasMore: true,
        beforeOffset: 100
      })
      return () => {}
    })
    await mount({ sendRequest, subscribe } as unknown as RpcClient)
    act(() => state?.loadEarlier())
    await act(async () => emit({ type: 'appended', messages: [message('live-trim')] }))
    await act(async () => {
      resolveCursorPage({
        ok: true,
        result: { messages: [message('stale-cursor-page')], hasMore: true, beforeOffset: 50 }
      })
      await Promise.resolve()
    })
    expect(state?.messages.map((entry) => entry.id)).not.toContain('stale-cursor-page')

    await act(async () => {
      state?.loadEarlier()
      await Promise.resolve()
    })

    expect(sendRequest).toHaveBeenLastCalledWith('nativeChat.readSession', {
      agent: 'claude',
      sessionId: 'session',
      limit: 100
    })
    expect(state?.messages.map((entry) => entry.id)).toEqual(['fresh-growing-tail'])
  })
})

describe('useMobileNativeChatSession transcriptLoading', () => {
  let renderer: ReactTestRenderer | null = null
  const renders: {
    sessionId: string | null
    transcriptLoading: boolean
    status: string
    ids: string[]
  }[] = []

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    renders.length = 0
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function Harness({
    client,
    sessionId,
    agent = 'claude'
  }: {
    client: RpcClient | null
    sessionId: string | null
    agent?: string | null
  }): null {
    const session = useMobileNativeChatSession({
      client,
      agent,
      sessionId,
      transcriptPath: null
    })
    renders.push({
      sessionId,
      transcriptLoading: session.transcriptLoading,
      status: session.status,
      ids: session.messages.map((entry) => entry.id)
    })
    return null
  }

  async function mountAt(client: RpcClient | null, sessionId: string | null): Promise<void> {
    const original = console.error
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      if (typeof args[0] === 'string' && args[0].includes('react-test-renderer is deprecated')) {
        return
      }
      original(...args)
    })
    try {
      await act(async () => {
        renderer = create(createElement(Harness, { client, sessionId }))
      })
    } finally {
      consoleSpy.mockRestore()
    }
  }

  it('reports loading on the very first render, before the subscription effect runs', async () => {
    // `status` starts at 'idle', so on its own it would tell the launch-draft
    // seed that an empty transcript is this session's real history.
    const subscribe: RpcClient['subscribe'] = vi.fn(() => () => {})
    await mountAt({ subscribe } as unknown as RpcClient, 'session-a')

    expect(renders[0]).toMatchObject({ transcriptLoading: true, ids: [] })
  })

  it('re-reads instead of resurfacing a settled read when the same identity returns', async () => {
    // Leaving chat view nulls the agent, then returning restores the identity a
    // settled read already matched — but its list was cleared, so trusting it
    // would report 'ready' over an empty transcript.
    const subscribe: RpcClient['subscribe'] = vi.fn((_method, _params, onData) => {
      onData({ type: 'snapshot', messages: [message('a-1')], hasMore: false })
      return () => {}
    })
    const client = { subscribe } as unknown as RpcClient
    await mountAt(client, 'session-a')
    expect(renders.at(-1)).toMatchObject({ status: 'ready', transcriptLoading: false })

    // Toggle out to the terminal view, then back.
    await act(async () =>
      renderer?.update(createElement(Harness, { client, sessionId: 'session-a', agent: null }))
    )
    renders.length = 0
    await act(async () =>
      renderer?.update(createElement(Harness, { client, sessionId: 'session-a', agent: 'claude' }))
    )

    expect(renders[0]).toMatchObject({ status: 'loading', transcriptLoading: true, ids: [] })
  })

  it('re-reads instead of resurfacing a settled read after a reconnect', async () => {
    // A reconnect swaps the client without moving the identity; the effect
    // re-subscribes and clears the list, so the old outcome must not stand.
    const subscribe: RpcClient['subscribe'] = vi.fn((_method, _params, onData) => {
      onData({ type: 'snapshot', messages: [message('a-1')], hasMore: false })
      return () => {}
    })
    const client = { subscribe } as unknown as RpcClient
    await mountAt(client, 'session-a')
    expect(renders.at(-1)).toMatchObject({ status: 'ready' })

    const reconnected = { subscribe: vi.fn(() => () => {}) } as unknown as RpcClient
    renders.length = 0
    await act(async () =>
      renderer?.update(createElement(Harness, { client: reconnected, sessionId: 'session-a' }))
    )

    expect(renders[0]).toMatchObject({ status: 'loading', transcriptLoading: true, ids: [] })
  })

  it('never hands out the previous session’s messages under the new session id', async () => {
    const subscribe: RpcClient['subscribe'] = vi.fn((_method, params, onData) => {
      if ((params as { sessionId: string }).sessionId === 'session-a') {
        onData({ type: 'snapshot', messages: [message('a-1')], hasMore: false })
      }
      return () => {}
    })
    const client = { subscribe } as unknown as RpcClient
    await mountAt(client, 'session-a')
    await act(async () =>
      renderer?.update(createElement(Harness, { client, sessionId: 'session-b' }))
    )

    // The effect that resets the list lands a commit later, so `messages` still
    // holds session-a's transcript here — it must never surface under b, and b
    // must read as loading until its own read settles.
    const leaked = renders.find(
      (entry) => entry.sessionId === 'session-b' && entry.ids.includes('a-1')
    )
    expect(leaked).toBeUndefined()
    expect(renders.find((entry) => entry.sessionId === 'session-b')).toMatchObject({
      transcriptLoading: true,
      ids: []
    })
  })
})
