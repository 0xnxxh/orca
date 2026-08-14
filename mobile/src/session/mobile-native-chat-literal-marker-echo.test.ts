// Outcome-level guard for STA-4363 on mobile: what the chat list ends up
// showing after a send whose text is nothing but `[Image #n]` markers, and what
// an incomplete multi-image echo is allowed to do to the local previews.

import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it } from 'vitest'
import {
  isImageRefBlock,
  isTextBlock,
  type NativeChatMessage
} from '../../../src/shared/native-chat-types'
import {
  buildMobileNativeChatTransientData,
  foldMobileNativeChatMessages
} from './mobile-native-chat-render-data'
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

describe('mobile literal image-marker turns', () => {
  let renderer: ReactTestRenderer | null = null
  let state: DraftState | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    state = null
  })

  function Harness({ messages = [] }: { messages?: NativeChatMessage[] }): null {
    state = useMobileNativeChatDrafts({
      hostId: 'host',
      worktreeId: 'worktree',
      tabId: 'a',
      sessionId: 'session-a',
      messages
    })
    return null
  }

  async function mount(): Promise<void> {
    await act(async () => {
      renderer = create(createElement(Harness, {}))
    })
  }

  async function transcript(messages: NativeChatMessage[]): Promise<void> {
    await act(async () => renderer?.update(createElement(Harness, { messages })))
  }

  function send(text: string, images?: string[]): void {
    const origin = state?.captureSendOrigin(text, images)
    act(() => {
      if (origin) {
        state?.acceptSend(origin, text, images)
      }
    })
  }

  /** The rows the chat list renders: folded transcript (with any rebound local
   *  previews) followed by the still-unreconciled optimistic echoes. */
  function rows(messages: NativeChatMessage[]): NativeChatMessage[] {
    return buildMobileNativeChatTransientData({
      folded: foldMobileNativeChatMessages(messages),
      streaming: null,
      pending: state?.pending ?? [],
      imagePreviewsByMessageId: state?.imagePreviewsByMessageId
    }).data
  }

  function rowText(message: NativeChatMessage): string {
    return message.blocks
      .filter(isTextBlock)
      .map((block) => block.text)
      .join('')
  }

  function rowImages(message: NativeChatMessage): string[] {
    return message.blocks
      .filter(isImageRefBlock)
      .map((block) => block.url ?? block.path ?? '')
      .filter(Boolean)
  }

  it('shows a standalone marker-only send exactly once', async () => {
    await mount()
    send('[Image #1]')

    const messages = [userTextMessage('u1', '[Image #1]')]
    await transcript(messages)

    expect(rows(messages).map(rowText)).toEqual(['[Image #1]'])
  })

  it('shows a marker-only send with surrounding prose exactly once', async () => {
    await mount()
    send('keep [Image #1] literal')

    const messages = [userTextMessage('u1', 'keep [Image #1] literal')]
    await transcript(messages)

    expect(rows(messages).map(rowText)).toEqual(['keep [Image #1] literal'])
  })

  it('holds every preview on the optimistic echo until the marker echo covers them all', async () => {
    await mount()
    send('', ['file:///a.jpg', 'file:///b.jpg'])

    const partial = [userTextMessage('prompt', '[Image #1]')]
    await transcript(partial)

    const partialRows = rows(partial)
    expect(partialRows.map(rowImages)).toEqual([[], ['file:///a.jpg', 'file:///b.jpg']])
    expect(state?.imagePreviewsByMessageId).toEqual({})

    const complete = [userTextMessage('prompt', '[Image #1] [Image #2]')]
    await transcript(complete)

    expect(state?.imagePreviewsByMessageId).toEqual({
      prompt: ['file:///a.jpg', 'file:///b.jpg']
    })
    expect(rows(complete).map(rowImages)).toEqual([['file:///a.jpg', 'file:///b.jpg']])
  })

  it('still binds a single-image preview to its marker-only echo', async () => {
    await mount()
    send('', ['file:///a.jpg'])

    const messages = [userTextMessage('prompt', '[Image #1]')]
    await transcript(messages)

    expect(state?.imagePreviewsByMessageId).toEqual({ prompt: ['file:///a.jpg'] })
    expect(rows(messages).map(rowImages)).toEqual([['file:///a.jpg']])
  })

  it('still strips a real marker that follows an attached image', async () => {
    await mount()
    send('look', ['file:///a.jpg'])

    const messages = [
      userTextMessage('src', '[Image: source: /tmp/a.png]'),
      userTextMessage('prompt', 'look [Image #1]')
    ]
    await transcript(messages)

    const rendered = rows(messages)
    expect(rendered.map(rowText)).toEqual(['look'])
    expect(rendered.map(rowImages)).toEqual([['file:///a.jpg']])
  })
})
