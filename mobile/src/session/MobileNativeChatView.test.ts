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

  const message = {
    id: 'current',
    role: 'assistant' as const,
    blocks: [{ type: 'text' as const, text: 'current' }],
    timestamp: 0,
    source: 'transcript' as const
  }
  const older = { ...message, id: 'older', blocks: [{ type: 'text' as const, text: 'older' }] }

  it('does not defeat prepend anchoring when a short list was also at bottom', async () => {
    vi.useFakeTimers()
    try {
      await render({ messages: [message], hasMore: true })
      await act(async () => vi.runAllTimersAsync())
      scrollToEnd.mockClear()

      await update({ messages: [message], hasMore: true, loadingEarlier: true })
      // The spinner swapping in resizes the header — that layout pass must not
      // consume the hold, since the page has not arrived yet.
      const spinnerList = renderer!.root.find((node) => node.type === 'FlatList')
      act(() => spinnerList.props.onContentSizeChange())

      await update({ messages: [older, message], hasMore: false, loadingEarlier: false })
      const list = renderer!.root.find((node) => node.type === 'FlatList')
      expect(list.props.maintainVisibleContentPosition).toEqual({ minIndexForVisible: 0 })
      act(() => list.props.onContentSizeChange())
      await act(async () => vi.runAllTimersAsync())

      expect(scrollToEnd).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('holds position when an unrelated render lands before the layout pass', async () => {
    vi.useFakeTimers()
    try {
      await render({ messages: [message], hasMore: true })
      await act(async () => vi.runAllTimersAsync())
      scrollToEnd.mockClear()

      await update({ messages: [message], hasMore: true, loadingEarlier: true })
      await update({ messages: [older, message], hasMore: false, loadingEarlier: false })
      // A streaming tick or keystroke re-renders before the native content-size
      // event lands — the hold has to outlive it, or the anchoring is undone.
      await update({ messages: [older, message], hasMore: false, loadingEarlier: false })
      const list = renderer!.root.find((node) => node.type === 'FlatList')
      act(() => list.props.onContentSizeChange())
      await act(async () => vi.runAllTimersAsync())

      expect(scrollToEnd).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('drops an already-armed tail-follow when a page starts before it fires', async () => {
    vi.useFakeTimers()
    try {
      await render({ messages: [message], hasMore: true })
      await act(async () => vi.runAllTimersAsync())
      scrollToEnd.mockClear()

      // A message lands, arming the 60ms tail-follow; the reader taps "Load
      // earlier" inside that window, so the scroll must be abandoned.
      const appended = { ...message, id: 'appended' }
      await update({ messages: [message, appended], hasMore: true })
      await act(async () => vi.advanceTimersByTimeAsync(30))
      await update({ messages: [message, appended], hasMore: true, loadingEarlier: true })
      await act(async () => vi.advanceTimersByTimeAsync(60))

      expect(scrollToEnd).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('releases the hold when a page prepends nothing', async () => {
    vi.useFakeTimers()
    try {
      await render({ messages: [message], hasMore: true })
      await act(async () => vi.runAllTimersAsync())
      scrollToEnd.mockClear()

      // A failed/empty page clears `loadingEarlier` without prepending, so no
      // layout pass arrives to consume the hold. It must expire on its own.
      await update({ messages: [message], hasMore: true, loadingEarlier: true })
      await update({ messages: [message], hasMore: true, loadingEarlier: false })
      await act(async () => vi.runAllTimersAsync())
      scrollToEnd.mockClear()

      const appended = { ...message, id: 'appended' }
      await update({ messages: [message, appended], hasMore: true })
      const list = renderer!.root.find((node) => node.type === 'FlatList')
      act(() => list.props.onContentSizeChange())
      await act(async () => vi.runAllTimersAsync())

      expect(scrollToEnd).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('still follows the tail once the history page has settled', async () => {
    vi.useFakeTimers()
    try {
      await render({ messages: [message], hasMore: true })
      await act(async () => vi.runAllTimersAsync())
      // Drive a real paging cycle first: a hold that never releases would leave
      // the chat permanently unable to follow the agent.
      await update({ messages: [message], hasMore: true, loadingEarlier: true })
      await update({ messages: [older, message], hasMore: false, loadingEarlier: false })
      const settled = renderer!.root.find((node) => node.type === 'FlatList')
      act(() => settled.props.onContentSizeChange())
      // Stay well inside the hold's expiry so this proves the page's own layout
      // pass released it, not the never-latch safety net.
      await act(async () => vi.advanceTimersByTimeAsync(100))
      scrollToEnd.mockClear()

      const appended = { ...message, id: 'appended' }
      await update({ messages: [older, message, appended], hasMore: false })
      const list = renderer!.root.find((node) => node.type === 'FlatList')
      act(() => list.props.onContentSizeChange())
      await act(async () => vi.advanceTimersByTimeAsync(100))

      expect(scrollToEnd).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
