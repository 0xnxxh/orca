import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MobileNativeChatView } from './MobileNativeChatView'
import { styles } from './mobile-native-chat-view-styles'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  FlatList: 'FlatList',
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View'
}))

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
  sendErrorMessage?: string | null
  onClearSendError?: () => void
  inputLockReason?: 'disconnected' | 'waiting' | null
  agentWorking?: boolean
  onStop?: () => void
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
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.useRealTimers()
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

  function workingIndicator(): ReactTestInstance {
    return renderer!.root.find((node) => node.type === 'WorkingIndicator')
  }

  function stopButton(): ReactTestInstance {
    return renderer!.root.find((node) => node.props.accessibilityLabel === 'Stop the agent')
  }

  async function settleLockDebounce(): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
  }

  async function relock(inputLockReason: Overrides['inputLockReason']): Promise<void> {
    await act(async () => {
      renderer?.update(
        createElement(MobileNativeChatView, {
          messages: [],
          status: 'ready',
          agentWorking: true,
          inputLockReason,
          onSend: vi.fn().mockResolvedValue(true),
          pending: [],
          composerText: '',
          onComposerTextChange: vi.fn()
        })
      )
    })
  }

  it('marks the working row stale and blocks Stop once a disconnect settles', async () => {
    vi.useFakeTimers()
    await render({ agentWorking: true, inputLockReason: 'disconnected' })

    // Debounced with the composer lock: a blip must not flicker the row.
    expect(workingIndicator().props.stale).toBe(false)
    expect(stopButton().props.disabled).toBe(false)

    await settleLockDebounce()

    expect(workingIndicator().props.stale).toBe(true)
    expect(stopButton().props.disabled).toBe(true)
  })

  it('does not fire Stop while the status is stale', async () => {
    vi.useFakeTimers()
    const onStop = vi.fn()
    await render({ agentWorking: true, inputLockReason: 'disconnected', onStop })
    await settleLockDebounce()

    const stop = stopButton()
    // `disabled` is the real block — Pressable never claims the responder. The
    // dimmed style is the matching affordance, not the guard.
    expect(stop.props.disabled).toBe(true)
    expect(stop.props.style({ pressed: false })).toContainEqual(styles.stopDisabled)
    expect(stop.props.onPress).toBe(onStop)
  })

  it('keeps the row live when the agent is merely waiting on a lease', async () => {
    vi.useFakeTimers()
    await render({ agentWorking: true, inputLockReason: 'waiting' })
    await settleLockDebounce()

    expect(workingIndicator().props.stale).toBe(false)
    expect(stopButton().props.disabled).toBe(false)
  })

  // The composer lock latches on the first non-null reason and never unlatches
  // between reasons, so reading it directly would skip the hold on this edge.
  it('still holds 600ms when a settled lease wait drops to disconnected', async () => {
    vi.useFakeTimers()
    await render({ agentWorking: true, inputLockReason: 'waiting' })
    await settleLockDebounce()

    await relock('disconnected')

    expect(workingIndicator().props.stale).toBe(false)
    expect(stopButton().props.disabled).toBe(false)

    await settleLockDebounce()

    expect(workingIndicator().props.stale).toBe(true)
    expect(stopButton().props.disabled).toBe(true)
  })

  it('never goes stale when the link recovers inside the hold', async () => {
    vi.useFakeTimers()
    await render({ agentWorking: true, inputLockReason: 'disconnected' })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    await relock('waiting')
    await settleLockDebounce()

    // The armed timer has to be cancelled, not just overruled — a surviving one
    // would fire late and mute a row whose transport is already back.
    expect(workingIndicator().props.stale).toBe(false)
    expect(stopButton().props.disabled).toBe(false)
  })

  it('restores a live Stop as soon as the transport reconnects', async () => {
    vi.useFakeTimers()
    await render({ agentWorking: true, inputLockReason: 'disconnected' })
    await settleLockDebounce()
    expect(stopButton().props.disabled).toBe(true)

    // Reconnect always lands on 'waiting' first — the lease drops its ready
    // handles on disconnect, so it has to be re-acked before the lock clears.
    await relock('waiting')

    // Unlock is immediate (no debounce on the way out), so Stop comes straight back.
    expect(workingIndicator().props.stale).toBe(false)
    expect(stopButton().props.disabled).toBe(false)
  })
})
