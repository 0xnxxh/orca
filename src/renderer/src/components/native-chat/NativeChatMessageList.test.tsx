// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NATIVE_CHAT_LOAD_EARLIER_ERROR } from '../../../../shared/native-chat-load-earlier'
import type { NativeChatMessage } from '../../../../shared/native-chat-types'
import { NativeChatMessageList } from './NativeChatMessageList'
import type { NativeChatLiveSession } from './use-native-chat-live-session'

function session(
  loadEarlier: () => void,
  loadEarlierError: string | null,
  messages: NativeChatMessage[] = []
): NativeChatLiveSession {
  return {
    messages,
    status: 'ready',
    sessionId: 'session',
    agent: 'claude',
    hasMore: true,
    loadingEarlier: false,
    loadEarlierError,
    loadEarlier,
    readPhase: 'ready'
  }
}

function message(id: string): NativeChatMessage {
  return {
    id,
    role: 'user',
    blocks: [{ type: 'text', text: id }],
    timestamp: 1,
    source: 'transcript'
  }
}

function setScrollHeight(scroller: HTMLElement, value: number): void {
  Object.defineProperty(scroller, 'scrollHeight', { configurable: true, writable: true, value })
}

function renderList(
  loadEarlier: () => void,
  loadEarlierError: string | null
): {
  scroller: HTMLElement
  rerender: (error: string | null, messages?: NativeChatMessage[]) => void
} {
  const list = (error: string | null, messages: NativeChatMessage[] = []) => (
    <NativeChatMessageList
      session={session(loadEarlier, error, messages)}
      isWorking={false}
      expandSignal={false}
      fontScale={1}
    />
  )
  const view = render(list(loadEarlierError))
  const scroller = view.container.querySelector<HTMLElement>('.scrollbar-sleek')
  if (!scroller) {
    throw new Error('Missing native chat scroller')
  }
  Object.defineProperties(scroller, {
    scrollTop: { configurable: true, writable: true, value: 0 },
    scrollHeight: { configurable: true, writable: true, value: 1_000 },
    clientHeight: { configurable: true, value: 400 }
  })
  return {
    scroller,
    rerender: (error, messages) => view.rerender(list(error, messages))
  }
}

describe('NativeChatMessageList load earlier', () => {
  afterEach(cleanup)

  it('loads automatically near the top before a failure', () => {
    const loadEarlier = vi.fn()
    const { scroller } = renderList(loadEarlier, null)

    fireEvent.scroll(scroller)

    expect(loadEarlier).toHaveBeenCalledOnce()
  })

  it('blocks scroll retries after failure but keeps explicit retry', () => {
    const loadEarlier = vi.fn()
    const { scroller } = renderList(loadEarlier, NATIVE_CHAT_LOAD_EARLIER_ERROR)

    fireEvent.scroll(scroller)
    fireEvent.scroll(scroller)
    fireEvent.scroll(scroller)
    expect(loadEarlier).not.toHaveBeenCalled()

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Couldn’t load earlier messages. Try again'
      })
    )
    expect(loadEarlier).toHaveBeenCalledOnce()
  })

  it('discards a failed page anchor before live content grows', () => {
    const loadEarlier = vi.fn()
    const { scroller, rerender } = renderList(loadEarlier, null)
    fireEvent.scroll(scroller)

    setScrollHeight(scroller, 1_100)
    rerender(NATIVE_CHAT_LOAD_EARLIER_ERROR, [message('live')])

    expect(scroller.scrollTop).toBe(0)
  })

  it('captures current geometry again for an explicit retry', () => {
    const loadEarlier = vi.fn()
    const { scroller, rerender } = renderList(loadEarlier, null)
    fireEvent.scroll(scroller)
    rerender(NATIVE_CHAT_LOAD_EARLIER_ERROR)
    scroller.scrollTop = 25
    setScrollHeight(scroller, 1_200)

    fireEvent.click(screen.getByRole('button', { name: /Couldn’t load earlier messages/ }))
    setScrollHeight(scroller, 1_300)
    rerender(null, [message('older')])

    expect(scroller.scrollTop).toBe(125)
  })
})
