import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AskPrompt } from './mobile-native-chat-ask'
import { useMobileNativeChatAskDismiss } from './use-mobile-native-chat-ask-dismiss'

describe('useMobileNativeChatAskDismiss', () => {
  let renderer: ReactTestRenderer | null = null
  let state: ReturnType<typeof useMobileNativeChatAskDismiss> | null = null

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    state = null
  })

  function Harness({
    prompt,
    scopeKey = 'tab-1',
    observing = true
  }: {
    prompt: AskPrompt | null
    scopeKey?: string | null
    observing?: boolean
  }): null {
    state = useMobileNativeChatAskDismiss({ ask: prompt, scopeKey, observing })
    return null
  }

  async function mount(props: Parameters<typeof Harness>[0]): Promise<void> {
    const original = console.error
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      if (typeof args[0] === 'string' && args[0].includes('react-test-renderer is deprecated')) {
        return
      }
      original(...args)
    })
    try {
      await act(async () => {
        renderer = create(createElement(Harness, props))
      })
    } finally {
      consoleSpy.mockRestore()
    }
  }

  async function update(props: Parameters<typeof Harness>[0]): Promise<void> {
    await act(async () => renderer?.update(createElement(Harness, props)))
  }

  const first: AskPrompt = {
    questions: [
      { question: 'same first', multiSelect: false, options: [] },
      { question: 'old second', multiSelect: false, options: [] }
    ]
  }
  const replacement: AskPrompt = {
    questions: [
      { question: 'same first', multiSelect: false, options: [] },
      { question: 'new second', multiSelect: false, options: [] }
    ]
  }

  it('shows a structurally different replacement without an intervening null', async () => {
    await mount({ prompt: first })
    act(() => state?.dismissAsk())
    expect(state?.showAsk).toBe(false)

    await update({ prompt: replacement })
    expect(state?.showAsk).toBe(true)
  })

  it('keeps a dismissal across a chat→terminal→chat toggle', async () => {
    // While the chat surface is hidden the prompt derives to null; that null
    // proves nothing about the agent and must not reset the dismissal.
    await mount({ prompt: first })
    act(() => state?.dismissAsk())

    await update({ prompt: null, observing: false })
    await update({ prompt: first, observing: true })

    expect(state?.showAsk).toBe(false)
  })

  it('forgets the dismissal once the prompt clears while observable', async () => {
    await mount({ prompt: first })
    act(() => state?.dismissAsk())

    // Agent moved on: the prompt cleared with chat visible.
    await update({ prompt: null, observing: true })
    await update({ prompt: first, observing: true })

    expect(state?.showAsk).toBe(true)
  })

  it('scopes the dismissal to the tab that showed the card', async () => {
    await mount({ prompt: first, scopeKey: 'tab-1' })
    act(() => state?.dismissAsk())

    // The same question on another tab is a different pending prompt.
    await update({ prompt: first, scopeKey: 'tab-2' })
    expect(state?.showAsk).toBe(true)

    // Returning to the dismissing tab keeps it hidden.
    await update({ prompt: first, scopeKey: 'tab-1' })
    expect(state?.showAsk).toBe(false)
  })
})
