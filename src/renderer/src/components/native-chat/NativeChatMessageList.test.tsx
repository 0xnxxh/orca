// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NATIVE_CHAT_LOAD_EARLIER_ERROR } from '../../../../shared/native-chat-load-earlier'
import { NativeChatMessageList } from './NativeChatMessageList'
import type { NativeChatLiveSession } from './use-native-chat-live-session'

function session(loadEarlier: () => void, loadEarlierError: string | null): NativeChatLiveSession {
  return {
    messages: [],
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

function renderList(loadEarlier: () => void, loadEarlierError: string | null): HTMLElement {
  const view = render(
    <NativeChatMessageList
      session={session(loadEarlier, loadEarlierError)}
      isWorking={false}
      expandSignal={false}
      fontScale={1}
    />
  )
  const scroller = view.container.querySelector<HTMLElement>('.scrollbar-sleek')
  if (!scroller) {
    throw new Error('Missing native chat scroller')
  }
  Object.defineProperties(scroller, {
    scrollTop: { configurable: true, writable: true, value: 0 },
    scrollHeight: { configurable: true, value: 1_000 },
    clientHeight: { configurable: true, value: 400 }
  })
  return scroller
}

describe('NativeChatMessageList load earlier', () => {
  afterEach(cleanup)

  it('loads automatically near the top before a failure', () => {
    const loadEarlier = vi.fn()
    const scroller = renderList(loadEarlier, null)

    fireEvent.scroll(scroller)

    expect(loadEarlier).toHaveBeenCalledOnce()
  })

  it('blocks scroll retries after failure but keeps explicit retry', () => {
    const loadEarlier = vi.fn()
    const scroller = renderList(loadEarlier, NATIVE_CHAT_LOAD_EARLIER_ERROR)

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
})
