import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MobileNativeChatView } from './MobileNativeChatView'

const { scrollToEnd } = vi.hoisted(() => ({ scrollToEnd: vi.fn() }))

vi.mock('react-native', async () => {
  const React = await import('react')
  return {
    ActivityIndicator: 'ActivityIndicator',
    FlatList: React.forwardRef((props: object, ref) => {
      React.useImperativeHandle(ref, () => ({ scrollToEnd }))
      return React.createElement('FlatList', props)
    }),
    Pressable: 'Pressable',
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    Text: 'Text',
    View: 'View'
  }
})

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 })
}))

vi.mock('react-native-gesture-handler', () => {
  const chain = {
    runOnJS: () => chain,
    onStart: () => chain,
    onUpdate: () => chain
  }
  return {
    Gesture: { Simultaneous: () => ({}), Native: () => ({}), Pinch: () => chain },
    GestureDetector: 'GestureDetector',
    GestureHandlerRootView: 'GestureHandlerRootView'
  }
})

vi.mock('lucide-react-native', () => ({
  ArrowDown: 'ArrowDown',
  ChevronsDownUp: 'ChevronsDownUp',
  ChevronsUpDown: 'ChevronsUpDown',
  Square: 'Square'
}))

vi.mock('./MobileNativeChatMessage', () => ({ MobileNativeChatMessage: 'ChatMessage' }))
vi.mock('./MobileNativeChatAsk', () => ({ MobileNativeChatAsk: 'ChatAsk' }))
vi.mock('./MobileNativeChatPermission', () => ({ MobileNativeChatPermission: 'ChatPermission' }))
vi.mock('./MobileNativeChatQuestion', () => ({ MobileNativeChatQuestion: 'ChatQuestion' }))
vi.mock('./MobileAgentWorkingIndicator', () => ({
  MobileAgentWorkingIndicator: 'WorkingIndicator'
}))

// Stand-in composer: exposes the view's `handleSend` through a pressable, which is
// the only composer behaviour these banner tests exercise.
vi.mock('./MobileNativeChatComposer', async () => {
  const React = await import('react')
  return {
    MobileNativeChatComposer: (props: { onSend: (text: string) => Promise<boolean> }) =>
      React.createElement('Composer', {
        accessibilityLabel: 'Send message',
        onPress: () => props.onSend('hi')
      })
  }
})

type Overrides = {
  messages?: Parameters<typeof MobileNativeChatView>[0]['messages']
  sendErrorMessage?: string | null
  onClearSendError?: () => void
  inputLockReason?: 'disconnected' | 'waiting' | null
  hasMore?: boolean
  loadingEarlier?: boolean
  loadEarlierError?: string | null
  onLoadEarlier?: () => void
  onSend?: (text: string) => Promise<boolean>
}

function suppressRendererWarning(): () => void {
  const original = console.error
  const spy = vi.spyOn(console, 'error').mockImplementation((...args) => {
    if (typeof args[0] === 'string' && args[0].includes('react-test-renderer is deprecated')) {
      return
    }
    original(...args)
  })
  return () => spy.mockRestore()
}

describe('MobileNativeChatView', () => {
  let renderer: ReactTestRenderer | null = null

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    scrollToEnd.mockClear()
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  async function render(overrides: Overrides = {}): Promise<void> {
    const restore = suppressRendererWarning()
    try {
      await act(async () => {
        renderer = create(
          createElement(MobileNativeChatView, {
            messages: [],
            status: 'ready',
            streamIdentity: 'test-stream',
            onSend: overrides.onSend ?? vi.fn().mockResolvedValue(true),
            pending: [],
            composerText: '',
            onComposerTextChange: vi.fn(),
            ...overrides
          })
        )
      })
    } finally {
      restore()
    }
  }

  async function update(overrides: Overrides = {}): Promise<void> {
    await act(async () => {
      renderer?.update(
        createElement(MobileNativeChatView, {
          messages: [],
          status: 'ready',
          streamIdentity: 'test-stream',
          onSend: vi.fn().mockResolvedValue(true),
          pending: [],
          composerText: '',
          onComposerTextChange: vi.fn(),
          ...overrides
        })
      )
    })
  }

  function banners(): ReactTestInstance[] {
    return renderer!.root.findAll((node) => node.props.accessibilityRole === 'alert')
  }

  function bannerText(): string {
    const [alert, ...rest] = banners()
    expect(rest).toHaveLength(0)
    return alert
      .findAll((node) => node.type === 'Text')
      .map((node) => node.props.children)
      .join('')
  }

  async function pressSend(): Promise<void> {
    const composer = renderer!.root.find((node) => node.type === 'Composer') as {
      props: { onPress: () => Promise<boolean> }
    }
    await act(async () => {
      await composer.props.onPress()
    })
  }

  it('renders the route-reported failure verbatim', async () => {
    await render({ sendErrorMessage: 'Permission reply failed' })

    expect(banners()).toHaveLength(1)
    expect(bannerText()).toContain('Permission reply failed')
  })

  it('does not duplicate the route banner when the composer rejects', async () => {
    const onClearSendError = vi.fn()
    await render({
      onSend: vi.fn().mockResolvedValue(false),
      inputLockReason: 'disconnected',
      sendErrorMessage: 'Stop failed',
      onClearSendError
    })
    await pressSend()

    expect(onClearSendError).not.toHaveBeenCalled()
    expect(banners()).toHaveLength(1)
    expect(bannerText()).toContain('Stop failed')
    expect(bannerText()).toBe('Stop failed')
  })

  it('retires the route-owned banner once a send is accepted', async () => {
    const onClearSendError = vi.fn()
    await render({ sendErrorMessage: 'Stop failed', onClearSendError })

    await pressSend()

    expect(onClearSendError).toHaveBeenCalledOnce()
  })

  it('blocks automatic paging but keeps explicit retry after loading earlier fails', async () => {
    const onLoadEarlier = vi.fn()
    await render({
      hasMore: true,
      loadEarlierError: 'Couldn’t load earlier messages',
      onLoadEarlier
    })
    const list = renderer!.root.find((node) => node.type === 'FlatList')

    act(() => {
      list.props.onScroll({
        nativeEvent: {
          contentOffset: { y: 0 },
          contentSize: { height: 1000 },
          layoutMeasurement: { height: 400 }
        }
      })
    })

    expect(onLoadEarlier).not.toHaveBeenCalled()
    await act(async () => list.props.ListHeaderComponent.props.onLoadEarlier())
    expect(onLoadEarlier).toHaveBeenCalledOnce()
  })

  it('does not defeat prepend anchoring when a short list was also at bottom', async () => {
    vi.useFakeTimers()
    const current = {
      id: 'current',
      role: 'assistant' as const,
      blocks: [{ type: 'text' as const, text: 'current' }],
      timestamp: 0,
      source: 'transcript' as const
    }
    const older = { ...current, id: 'older', blocks: [{ type: 'text' as const, text: 'older' }] }
    try {
      await render({ messages: [current], hasMore: true })
      await act(async () => vi.runAllTimersAsync())
      scrollToEnd.mockClear()

      await update({ messages: [current], hasMore: true, loadingEarlier: true })
      await update({ messages: [older, current], hasMore: false, loadingEarlier: false })
      const list = renderer!.root.find((node) => node.type === 'FlatList')
      act(() => list.props.onContentSizeChange())
      await act(async () => vi.runAllTimersAsync())

      expect(scrollToEnd).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
