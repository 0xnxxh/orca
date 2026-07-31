import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'

vi.mock('react-native', async () => {
  const React = await import('react')
  return {
    Image: 'Image',
    ActivityIndicator: 'ActivityIndicator',
    Pressable: 'Pressable',
    Text: ({ children, ...props }: { children?: unknown }) =>
      React.createElement('Text', props, children),
    View: ({ children, ...props }: { children?: unknown }) =>
      React.createElement('View', props, children),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 }
  }
})
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }))
vi.mock('lucide-react-native', () => ({
  ArrowUp: 'ArrowUp',
  ChevronDown: 'ChevronDown',
  Copy: 'Copy',
  SquareChevronRight: 'SquareChevronRight'
}))
vi.mock('../components/MobileMarkdown', () => ({ MobileMarkdown: 'MobileMarkdown' }))

import { MobileNativeChatMessage } from './MobileNativeChatMessage'
import { mobileNativeChatTextKey } from './use-mobile-native-chat-text-expansion'
import type { MobileNativeChatTextExpansion } from './use-mobile-native-chat-text-expansion'

function userMessage(blocks: NativeChatMessage['blocks']): NativeChatMessage {
  return { id: 'u1', role: 'user', blocks, timestamp: null, source: 'transcript' }
}

describe('MobileNativeChatMessage image-ref rendering', () => {
  let renderer: ReactTestRenderer | null = null

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function render(
    message: NativeChatMessage,
    textExpansion?: MobileNativeChatTextExpansion
  ): ReactTestRenderer {
    const original = console.error
    const spy = vi.spyOn(console, 'error').mockImplementation((...a) => {
      if (typeof a[0] === 'string' && a[0].includes('react-test-renderer is deprecated')) {
        return
      }
      original(...a)
    })
    try {
      act(() => {
        renderer = create(createElement(MobileNativeChatMessage, { message, textExpansion }))
      })
    } finally {
      spy.mockRestore()
    }
    return renderer!
  }

  it('renders a loadable preview URI as an image thumbnail', () => {
    const tree = render(userMessage([{ type: 'image-ref', url: 'file:///a.jpg', alt: 'a photo' }]))
    const image = tree.root.findByType('Image' as never)
    expect(image.props.source).toEqual({ uri: 'file:///a.jpg' })
    expect(image.props.accessibilityLabel).toBe('a photo')
  })

  it('prefers the url over the path when both are present', () => {
    const tree = render(
      userMessage([{ type: 'image-ref', url: 'file:///local.jpg', path: '/tmp/host.png' }])
    )
    expect(tree.root.findByType('Image' as never).props.source).toEqual({
      uri: 'file:///local.jpg'
    })
  })

  it('falls back to a text placeholder for a bare host path', () => {
    // A host temp path (e.g. on an SSH host) is not loadable on the device.
    const tree = render(userMessage([{ type: 'image-ref', path: '/tmp/host.png' }]))
    expect(tree.root.findAllByType('Image' as never)).toHaveLength(0)
    const texts = tree.root
      .findAllByType('Text' as never)
      .map((node) => String(node.children.join('')))
    expect(texts.some((text) => text.includes('/tmp/host.png'))).toBe(true)
  })

  it.each([
    ['ordinary prose', `Summary\n\n${'Readable paragraph. '.repeat(300)}`],
    ['fenced code', `\`\`\`ts\n${'const answer = 42\n'.repeat(300)}\`\`\``]
  ])('renders complete %s after lazy expansion', (_label, fullText) => {
    const retrieval = { recordOffset: 42, blockIndex: 0, originalChars: fullText.length }
    const message: NativeChatMessage = {
      id: 'assistant-1',
      role: 'assistant',
      blocks: [{ type: 'text', text: `${fullText.slice(0, 4000)}\n… (truncated)`, retrieval }],
      timestamp: null,
      source: 'transcript'
    }
    const key = mobileNativeChatTextKey(message.id, retrieval)
    const textExpansion: MobileNativeChatTextExpansion = {
      cached: { key, text: fullText },
      expandedKey: key,
      loadingKey: null,
      errorKey: null,
      toggle: vi.fn()
    }

    const tree = render(message, textExpansion)

    expect(tree.root.findByType('MobileMarkdown' as never).props.content).toBe(fullText)
    expect(tree.root.findByProps({ accessibilityLabel: 'Show less' })).toBeTruthy()
  })
})
