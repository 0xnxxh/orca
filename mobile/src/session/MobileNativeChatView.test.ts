import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { MobileNativeChatView } from './MobileNativeChatView'
import { styles } from './mobile-native-chat-view-styles'

const mocks = vi.hoisted(() => ({ staleRenders: [] as boolean[] }))

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
vi.mock('./MobileAgentWorkingIndicator', async () => {
  const React = await import('react')
  return {
    MobileAgentWorkingIndicator: ({ stale = false }: { stale?: boolean }) => {
      mocks.staleRenders.push(stale)
      return React.createElement('WorkingIndicator', { stale })
    }
  }
})

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
  folded?: Parameters<typeof MobileNativeChatView>[0]['folded']
  streaming?: string | null
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

function assistantTurn(id: string, text: string): NativeChatMessage {
  return { id, role: 'assistant', blocks: [{ type: 'text', text }], timestamp: 0, source: 'hook' }
}

function chatViewElement(overrides: Overrides): ReturnType<typeof createElement> {
  return createElement(MobileNativeChatView, {
    messages: [],
    folded: [],
    status: 'ready',
    streaming: null,
    onSend: vi.fn().mockResolvedValue(true),
    onStop: vi.fn(),
    pending: [],
    composerText: '',
    onComposerTextChange: vi.fn(),
    ...overrides
  })
}

describe('MobileNativeChatView', () => {
  let renderer: ReactTestRenderer | null = null

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    mocks.staleRenders.length = 0
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
        renderer = create(chatViewElement(overrides))
      })
    } finally {
      restore()
    }
  }

  async function update(overrides: Overrides = {}): Promise<void> {
    await act(async () => {
      renderer?.update(chatViewElement(overrides))
    })
  }

  /** Ids of the rows the list is currently rendering. */
  function listIds(): string[] {
    const list = renderer!.root.find((node) => node.type === 'FlatList')
    return (list.props.data as { id: string }[]).map((row) => row.id)
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
    await update({ agentWorking: true, inputLockReason })
  }

  it('blocks Stop immediately and marks the working row stale once a disconnect settles', async () => {
    vi.useFakeTimers()
    await render({ agentWorking: true, inputLockReason: 'disconnected' })

    // The label is held to avoid flicker; the unreachable action is not.
    expect(workingIndicator().props.stale).toBe(false)
    expect(stopButton().props.disabled).toBe(true)

    await settleLockDebounce()

    expect(workingIndicator().props.stale).toBe(true)
    expect(stopButton().props.disabled).toBe(true)
  })

  it('disables and dims Stop while disconnected', async () => {
    vi.useFakeTimers()
    const onStop = vi.fn()
    await render({ agentWorking: true, inputLockReason: 'disconnected', onStop })
    await settleLockDebounce()

    const stop = stopButton()
    // `disabled` is the behavioral guard; opacity is only its affordance.
    expect(stop.props.disabled).toBe(true)
    expect(stop.props.style({ pressed: false })).toContainEqual(styles.stopDisabled)
    expect(stop.props.onPress).toBe(onStop)
  })

  it('keeps the row live but blocks Stop while waiting on a lease', async () => {
    vi.useFakeTimers()
    await render({ agentWorking: true, inputLockReason: 'waiting' })
    await settleLockDebounce()

    expect(workingIndicator().props.stale).toBe(false)
    expect(stopButton().props.disabled).toBe(true)
  })

  // The composer lock latches on the first non-null reason and never unlatches
  // between reasons, so reading it directly would skip the hold on this edge.
  it('still holds 600ms when a settled lease wait drops to disconnected', async () => {
    vi.useFakeTimers()
    await render({ agentWorking: true, inputLockReason: 'waiting' })
    await settleLockDebounce()

    await relock('disconnected')

    expect(workingIndicator().props.stale).toBe(false)
    expect(stopButton().props.disabled).toBe(true)

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

    // A surviving timer would mute a row whose transport is already back.
    expect(workingIndicator().props.stale).toBe(false)
    expect(stopButton().props.disabled).toBe(true)
  })

  it('clears stale feedback on reconnect and restores Stop once the lease is ready', async () => {
    vi.useFakeTimers()
    await render({ agentWorking: true, inputLockReason: 'disconnected' })
    await settleLockDebounce()
    expect(stopButton().props.disabled).toBe(true)

    // Reconnect always lands on 'waiting' first — the lease drops its ready
    // handles on disconnect, so it has to be re-acked before the lock clears.
    await relock('waiting')

    // The stale label clears immediately, but the action stays blocked until its write gate opens.
    expect(workingIndicator().props.stale).toBe(false)
    expect(stopButton().props.disabled).toBe(true)

    await relock(null)

    expect(workingIndicator().props.stale).toBe(false)
    expect(stopButton().props.disabled).toBe(false)
  })

  it('never renders stale feedback after the transport reconnects', async () => {
    vi.useFakeTimers()
    await render({ agentWorking: true, inputLockReason: 'disconnected' })
    await settleLockDebounce()
    expect(workingIndicator().props.stale).toBe(true)

    mocks.staleRenders.length = 0
    await relock('waiting')

    expect(mocks.staleRenders.length).toBeGreaterThan(0)
    expect(mocks.staleRenders).not.toContain(true)
  })

  it('restarts the hold when the recovered transport disconnects again', async () => {
    vi.useFakeTimers()
    await render({ agentWorking: true, inputLockReason: 'disconnected' })
    await settleLockDebounce()
    await relock('waiting')

    await relock('disconnected')
    expect(workingIndicator().props.stale).toBe(false)

    await settleLockDebounce()
    expect(workingIndicator().props.stale).toBe(true)
  })

  // The gate that decides `streaming` lives in MobileNativeChatOverlay, which
  // outlives this view; see MobileNativeChatOverlay.test.ts.
  it('appends the gated streaming bubble after the folded transcript', async () => {
    const folded = [assistantTurn('a1', 'The tests pass.')]
    await render({ folded })
    expect(listIds()).toEqual(['a1'])

    await update({ folded, streaming: 'The tests' })

    expect(listIds()).toEqual(['a1', 'streaming'])
  })
})
