import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { useMobileNativeChatDrafts } from './use-mobile-native-chat-drafts'

type DraftState = ReturnType<typeof useMobileNativeChatDrafts>

function userTextMessage(id: string, text: string): NativeChatMessage {
  return {
    id,
    role: 'user',
    blocks: [{ type: 'text', text }],
    timestamp: null,
    source: 'transcript'
  }
}

function assistantTextMessage(id: string, text: string): NativeChatMessage {
  return {
    id,
    role: 'assistant',
    blocks: [{ type: 'text', text }],
    timestamp: null,
    source: 'transcript'
  }
}

describe('useMobileNativeChatDrafts', () => {
  let renderer: ReactTestRenderer | null = null
  let state: DraftState | null = null

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    state = null
  })

  function Harness({
    tabId,
    sessionId = `session-${tabId}`,
    messages = [],
    launchDraft = null
  }: {
    tabId: string
    sessionId?: string | null
    messages?: NativeChatMessage[]
    launchDraft?: string | null
  }): null {
    state = useMobileNativeChatDrafts({
      hostId: 'host',
      worktreeId: 'worktree',
      tabId,
      sessionId,
      messages,
      launchDraft
    })
    return null
  }

  async function mount(tabId: string): Promise<void> {
    const original = console.error
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      if (typeof args[0] === 'string' && args[0].includes('react-test-renderer is deprecated')) {
        return
      }
      original(...args)
    })
    try {
      await act(async () => {
        renderer = create(createElement(Harness, { tabId }))
      })
    } finally {
      consoleSpy.mockRestore()
    }
  }

  async function switchTo(tabId: string): Promise<void> {
    await act(async () => renderer?.update(createElement(Harness, { tabId })))
  }

  it('keeps drafts and accepted pending messages on their originating tabs', async () => {
    await mount('a')
    act(() => state?.setComposerText('from a'))
    const originA = state?.captureSendOrigin('from a')
    expect(originA).not.toBeNull()

    await switchTo('b')
    act(() => state?.setComposerText('from b'))
    act(() => {
      if (originA) {
        state?.acceptSend(originA, 'from a')
      }
    })
    expect(state?.composerText).toBe('from b')
    expect(state?.pending).toEqual([])

    await switchTo('a')
    expect(state?.composerText).toBe('')
    expect(state?.pending.map((pending) => pending.text)).toEqual(['from a'])
  })

  it('clears one pending per landed message so duplicate sends are not all dropped', async () => {
    await mount('a')
    const origin = state?.captureSendOrigin('ping')
    act(() => {
      if (origin) {
        state?.acceptSend(origin, 'ping')
        state?.acceptSend(origin, 'ping')
      }
    })
    expect(state?.pending.map((pending) => pending.text)).toEqual(['ping', 'ping'])

    await act(async () =>
      renderer?.update(
        createElement(Harness, { tabId: 'a', messages: [userTextMessage('m1', 'ping')] })
      )
    )
    expect(state?.pending.map((pending) => pending.text)).toEqual(['ping'])
  })

  it('does not reconcile a repeated send against an older identical turn', async () => {
    await mount('a')
    await act(async () =>
      renderer?.update(
        createElement(Harness, { tabId: 'a', messages: [userTextMessage('old', 'ping')] })
      )
    )
    const origin = state?.captureSendOrigin('ping')
    act(() => {
      if (origin) {
        state?.acceptSend(origin, 'ping')
      }
    })

    await act(async () =>
      renderer?.update(
        createElement(Harness, {
          tabId: 'a',
          messages: [userTextMessage('old', 'ping'), assistantTextMessage('other', 'working')]
        })
      )
    )
    expect(state?.pending.map((pending) => pending.text)).toEqual(['ping'])

    await act(async () =>
      renderer?.update(
        createElement(Harness, {
          tabId: 'a',
          messages: [
            userTextMessage('old', 'ping'),
            assistantTextMessage('other', 'working'),
            userTextMessage('new', 'ping')
          ]
        })
      )
    )
    expect(state?.pending).toEqual([])
  })

  it('does not erase newer edits when an older send settles', async () => {
    await mount('a')
    act(() => state?.setComposerText('submitted'))
    const origin = state?.captureSendOrigin('submitted')
    act(() => state?.setComposerText('new edit'))
    act(() => {
      if (origin) {
        state?.acceptSend(origin, 'submitted')
      }
    })

    expect(state?.composerText).toBe('new edit')
  })

  it('prefills the composer from a host launch draft exactly once', async () => {
    await mount('a')
    await act(async () =>
      renderer?.update(
        createElement(Harness, { tabId: 'a', launchDraft: 'https://github.com/o/r/issues/12' })
      )
    )
    expect(state?.composerText).toBe('https://github.com/o/r/issues/12')

    // A user clear must not see the prefill resurrected on the next render.
    act(() => state?.setComposerText(''))
    await act(async () =>
      renderer?.update(
        createElement(Harness, { tabId: 'a', launchDraft: 'https://github.com/o/r/issues/12' })
      )
    )
    expect(state?.composerText).toBe('')
  })

  it('does not overwrite typed composer text with a launch draft', async () => {
    await mount('a')
    act(() => state?.setComposerText('typed first'))
    await act(async () =>
      renderer?.update(createElement(Harness, { tabId: 'a', launchDraft: 'issue link' }))
    )
    expect(state?.composerText).toBe('typed first')
  })

  it('declines a launch draft when the transcript already has a user turn', async () => {
    await mount('a')
    await act(async () =>
      renderer?.update(
        createElement(Harness, {
          tabId: 'a',
          messages: [userTextMessage('m1', 'already sent')],
          launchDraft: 'issue link'
        })
      )
    )
    expect(state?.composerText).toBe('')
  })

  it('clears an untouched prefill once a user turn lands, keeping user edits', async () => {
    await mount('a')
    await act(async () =>
      renderer?.update(createElement(Harness, { tabId: 'a', launchDraft: 'issue link' }))
    )
    expect(state?.composerText).toBe('issue link')

    await act(async () =>
      renderer?.update(
        createElement(Harness, {
          tabId: 'a',
          messages: [userTextMessage('m1', 'sent from the TUI')],
          launchDraft: 'issue link'
        })
      )
    )
    expect(state?.composerText).toBe('')

    // Edited prefill survives resolution on another tab's copy.
    await act(async () =>
      renderer?.update(createElement(Harness, { tabId: 'b', launchDraft: 'issue link' }))
    )
    act(() => state?.setComposerText('issue link plus my notes'))
    await act(async () =>
      renderer?.update(
        createElement(Harness, {
          tabId: 'b',
          messages: [userTextMessage('m2', 'sent from the TUI')],
          launchDraft: 'issue link'
        })
      )
    )
    expect(state?.composerText).toBe('issue link plus my notes')
  })

  it('clears an untouched prefill when the host stops publishing the launch draft', async () => {
    await mount('a')
    await act(async () =>
      renderer?.update(createElement(Harness, { tabId: 'a', launchDraft: 'issue link' }))
    )
    expect(state?.composerText).toBe('issue link')

    await act(async () =>
      renderer?.update(createElement(Harness, { tabId: 'a', launchDraft: null }))
    )
    expect(state?.composerText).toBe('')
  })

  it('accepts and clears the first send before a provider session id exists', async () => {
    await mount('a')
    await act(async () => renderer?.update(createElement(Harness, { tabId: 'a', sessionId: null })))
    act(() => state?.setComposerText('start the session'))

    const origin = state?.captureSendOrigin('start the session')
    expect(origin).toMatchObject({ pendingKey: null })
    act(() => {
      if (origin) {
        state?.acceptSend(origin, 'start the session')
      }
    })

    expect(state?.composerText).toBe('')
    expect(state?.pending).toEqual([])
  })
})
