import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TextInputModal } from './TextInputModal'

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View'
}))

vi.mock('./BottomDrawer', () => ({
  BottomDrawer: ({ children }: { children: unknown }) => children
}))

function renderModal(defaultValue: string, onSubmit = vi.fn()): ReactTestRenderer {
  let renderer: ReactTestRenderer | null = null
  act(() => {
    renderer = create(
      createElement(TextInputModal, {
        defaultValue,
        onCancel: vi.fn(),
        onSubmit,
        title: 'Paste pairing code',
        visible: true
      })
    )
  })
  if (!renderer) {
    throw new Error('Text input modal did not render')
  }
  return renderer
}

describe('TextInputModal actions', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    const originalConsoleError = console.error
    vi.spyOn(console, 'error').mockImplementation((...args) => {
      if (typeof args[0] === 'string' && args[0].includes('react-test-renderer is deprecated')) {
        return
      }
      originalConsoleError(...args)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('exposes an enabled 44pt Save action and submits its trimmed value', () => {
    const onSubmit = vi.fn()
    const renderer = renderModal('  orca://pair?code=abc  ', onSubmit)
    const save = renderer.root
      .findAllByType('Pressable')
      .find((node) => node.props.accessibilityLabel === 'Save')

    expect(save?.props.accessibilityRole).toBe('button')
    expect(save?.props.accessibilityState).toEqual({ disabled: false })
    expect(save?.props.style({ pressed: false })[0]).toMatchObject({ minHeight: 44 })

    act(() => save?.props.onPress())
    expect(onSubmit).toHaveBeenCalledWith('orca://pair?code=abc')
    act(() => renderer.unmount())
  })

  it('reports the Save action as disabled when validation blocks submission', () => {
    const renderer = renderModal('   ')
    const save = renderer.root
      .findAllByType('Pressable')
      .find((node) => node.props.accessibilityLabel === 'Save')

    expect(save?.props.disabled).toBe(true)
    expect(save?.props.accessibilityState).toEqual({ disabled: true })
    act(() => renderer.unmount())
  })
})
