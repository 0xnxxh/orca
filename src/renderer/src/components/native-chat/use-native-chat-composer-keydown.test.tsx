// @vitest-environment happy-dom

import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EMPTY_HISTORY, type ComposerAutocomplete } from './native-chat-composer-state'
import { useNativeChatComposerKeyDown } from './use-native-chat-composer-keydown'

const COMMAND = {
  kind: 'command' as const,
  id: 'command:clear',
  name: 'clear',
  description: 'Clear history',
  skillCollision: false
}

function picker(items = [COMMAND]): Extract<ComposerAutocomplete, { mode: 'slash' }> {
  return {
    mode: 'slash',
    query: '',
    items,
    triggerKey: '/:0',
    prefix: '/',
    grouped: false,
    commandsEnabled: true,
    skillsEnabled: false,
    skillStatus: 'ready'
  }
}

function setup(autocomplete: ComposerAutocomplete = picker()) {
  const callbacks = {
    completePickerItem: vi.fn(),
    dispatchPickerCommand: vi.fn(),
    dismissPicker: vi.fn(),
    interrupt: vi.fn(),
    send: vi.fn(),
    setActiveSuggestion: vi.fn(),
    setDraft: vi.fn(),
    setCaret: vi.fn(),
    setHistory: vi.fn()
  }
  const hook = renderHook(() =>
    useNativeChatComposerKeyDown({
      autocomplete,
      activeSuggestion: 0,
      draft: '/',
      history: EMPTY_HISTORY,
      ...callbacks
    })
  )
  return { handler: hook.result.current, callbacks }
}

function keyEvent(
  key: string,
  { isComposing = false, keyCode = 0 }: { isComposing?: boolean; keyCode?: number } = {}
) {
  return {
    key,
    shiftKey: false,
    keyCode,
    nativeEvent: { isComposing, keyCode },
    preventDefault: vi.fn()
  }
}

describe('useNativeChatComposerKeyDown', () => {
  it('dispatches command Enter but completes command Tab', () => {
    const enter = setup()
    enter.handler(keyEvent('Enter') as never)
    expect(enter.callbacks.dispatchPickerCommand).toHaveBeenCalledWith(COMMAND)
    expect(enter.callbacks.completePickerItem).not.toHaveBeenCalled()

    const tab = setup()
    tab.handler(keyEvent('Tab') as never)
    expect(tab.callbacks.completePickerItem).toHaveBeenCalledWith(COMMAND)
    expect(tab.callbacks.dispatchPickerCommand).not.toHaveBeenCalled()
  })

  it('falls through to composer send when the open picker has no options', () => {
    const { handler, callbacks } = setup(picker([]))
    handler(keyEvent('Enter') as never)
    expect(callbacks.send).toHaveBeenCalledOnce()
  })

  it('dismisses Escape without interrupting the agent', () => {
    const { handler, callbacks } = setup()
    handler(keyEvent('Escape') as never)
    expect(callbacks.dismissPicker).toHaveBeenCalledWith('/:0')
    expect(callbacks.interrupt).not.toHaveBeenCalled()
  })

  it('does not accept or submit while IME composition is active', () => {
    const { handler, callbacks } = setup()
    const event = keyEvent('Enter', { isComposing: true, keyCode: 13 })
    handler(event as never)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(callbacks.dispatchPickerCommand).not.toHaveBeenCalled()
    expect(callbacks.send).not.toHaveBeenCalled()
  })

  it('ignores the recorded macOS IME Enter before handling its ordinary redispatch', () => {
    const { handler, callbacks } = setup()
    const compositionEnter = keyEvent('Enter', { isComposing: true, keyCode: 229 })
    handler(compositionEnter as never)
    expect(compositionEnter.preventDefault).not.toHaveBeenCalled()
    expect(callbacks.dispatchPickerCommand).not.toHaveBeenCalled()
    expect(callbacks.send).not.toHaveBeenCalled()

    const ordinaryRedispatch = keyEvent('Enter', { keyCode: 13 })
    handler(ordinaryRedispatch as never)
    expect(callbacks.dispatchPickerCommand).toHaveBeenCalledOnce()
  })
})
