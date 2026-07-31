import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MobileHostCard } from './MobileHostCard'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles },
  Text: 'Text',
  View: 'View'
}))

vi.mock('lucide-react-native', () => ({
  ChevronRight: 'ChevronRight',
  Monitor: 'Monitor',
  MoreVertical: 'MoreVertical'
}))

vi.mock('./StatusDot', () => ({
  StatusDot: 'StatusDot'
}))

function suppressRendererDeprecation() {
  return vi.spyOn(console, 'error').mockImplementation((...args) => {
    if (typeof args[0] !== 'string' || !args[0].includes('react-test-renderer is deprecated')) {
      throw new Error(String(args[0]))
    }
  })
}

describe('MobileHostCard', () => {
  let renderer: ReactTestRenderer | null = null

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.restoreAllMocks()
  })

  it('keeps host navigation and actions as separate accessible controls', async () => {
    const onPress = vi.fn()
    const onLongPress = vi.fn()
    const onOpenActions = vi.fn()
    const consoleError = suppressRendererDeprecation()
    await act(async () => {
      renderer = create(
        createElement(MobileHostCard, {
          host: {
            id: 'desk',
            name: 'Desk',
            endpoint: 'ws://192.168.1.2:6768',
            deviceToken: 'token',
            publicKeyB64: 'key',
            lastConnected: 1
          },
          state: 'disconnected',
          verdict: { kind: 'normal', label: 'Disconnected' },
          path: 'lan',
          onPress,
          onLongPress,
          onOpenActions
        })
      )
    })
    consoleError.mockRestore()

    const buttons = renderer.root.findAllByType('Pressable')
    expect(buttons).toHaveLength(2)
    expect(buttons[0].props.accessibilityLabel).toBe('Open Desk, Disconnected')
    expect(buttons[1].props.accessibilityLabel).toBe('Actions for Desk')

    act(() => buttons[1].props.onPress())
    expect(onOpenActions).toHaveBeenCalledOnce()
    expect(onPress).not.toHaveBeenCalled()

    act(() => buttons[0].props.onPress())
    act(() => buttons[0].props.onLongPress())
    expect(onPress).toHaveBeenCalledOnce()
    expect(onLongPress).toHaveBeenCalledOnce()
  })

  it('announces the connection path for an online host', async () => {
    const consoleError = suppressRendererDeprecation()
    await act(async () => {
      renderer = create(
        createElement(MobileHostCard, {
          host: {
            id: 'desk',
            name: 'Desk',
            endpoint: 'ws://192.168.1.2:6768',
            deviceToken: 'token',
            publicKeyB64: 'key',
            lastConnected: 1
          },
          state: 'connected',
          verdict: { kind: 'normal', label: 'Connected' },
          path: 'relay',
          onPress: vi.fn(),
          onLongPress: vi.fn(),
          onOpenActions: vi.fn()
        })
      )
    })
    consoleError.mockRestore()

    const navigationButton = renderer.root.findAllByType('Pressable')[0]
    expect(navigationButton.props.accessibilityLabel).toBe('Open Desk, Connected via Orca Relay')
  })
})
