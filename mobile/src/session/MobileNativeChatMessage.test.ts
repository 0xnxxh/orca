import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { MAX_TOOL_RESULT_CHARS } from './mobile-native-chat-message-styles'

vi.mock('react-native', async () => {
  const React = await import('react')
  return {
    Image: 'Image',
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

function userMessage(blocks: NativeChatMessage['blocks']): NativeChatMessage {
  return { id: 'u1', role: 'user', blocks, timestamp: null, source: 'transcript' }
}

describe('MobileNativeChatMessage', () => {
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
    props: { toolsExpanded?: boolean } = {}
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
        renderer = create(createElement(MobileNativeChatMessage, { message, ...props }))
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

  it('bounds expanded diff-less tool input before native text layout', () => {
    const tree = render(
      {
        id: 'a1',
        role: 'assistant',
        blocks: [
          { type: 'tool-call', name: 'CustomTool', input: { payload: 'x'.repeat(100_000) } }
        ],
        timestamp: null,
        source: 'transcript'
      },
      { toolsExpanded: true }
    )

    const detail = tree.root
      .findAllByType('Text' as never)
      .map((node) => String(node.children.join('')))
      .find((text) => text.startsWith('{\n'))
    expect(detail).toHaveLength(MAX_TOOL_RESULT_CHARS + 1)
    expect(detail?.endsWith('…')).toBe(true)
  })

  it('expands formatted detail for a pending JSON-string tool input', () => {
    const tree = render({
      id: 'a1',
      role: 'assistant',
      blocks: [
        {
          type: 'tool-call',
          name: 'CustomTool',
          input: '{"cmd":"git status","description":"Inspect changes"}'
        }
      ],
      timestamp: null,
      source: 'transcript'
    })
    const textIn = (node: ReactTestInstance): string[] =>
      node.findAllByType('Text' as never).map((text) => String(text.children.join('')))
    const pressableWith = (label: string) =>
      tree.root.findAllByType('Pressable' as never).find((node) => textIn(node).includes(label))!

    act(() => pressableWith('1×').props.onPress())
    expect(textIn(tree.root).some((text) => text.startsWith('{\n'))).toBe(false)

    act(() => pressableWith('CustomTool').props.onPress())
    expect(textIn(tree.root)).toContain(
      '{\n  "cmd": "git status",\n  "description": "Inspect changes"\n}'
    )
  })
})
