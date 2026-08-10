// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, renderHook } from '@testing-library/react'
import type { SearchAddon } from '@xterm/addon-search'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import TerminalSearch from '@/components/TerminalSearch'
import type { PaneManager } from '@/lib/pane-manager/pane-manager'
import type { PtyTransport } from './pty-transport'
import { type SearchState, useTerminalKeyboardShortcuts } from './keyboard-handlers'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

type KeyboardHandlersDeps = Parameters<typeof useTerminalKeyboardShortcuts>[0]

function createSearchAddon(): SearchAddon {
  return {
    findNext: vi.fn(() => true),
    findPrevious: vi.fn(() => true),
    clearDecorations: vi.fn()
  } as unknown as SearchAddon
}

function createHarness(userAgent: string): {
  addon: SearchAddon
  input: HTMLElement
  paneFocus: ReturnType<typeof vi.fn>
  shortcutTarget: HTMLTextAreaElement
} {
  vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(userAgent)
  const addon = createSearchAddon()
  const searchStateRef: React.RefObject<SearchState> = {
    current: { query: '', caseSensitive: false, regex: false }
  }
  const view = render(
    <TerminalSearch isOpen onClose={vi.fn()} searchAddon={addon} searchStateRef={searchStateRef} />
  )

  const scope = document.createElement('div')
  const terminalElement = document.createElement('div')
  const shortcutTarget = document.createElement('textarea')
  terminalElement.append(shortcutTarget)
  scope.append(terminalElement)
  document.body.append(scope)

  const paneFocus = vi.fn()
  const pane = {
    id: 1,
    leafId: '00000000-0000-4000-8000-000000000001',
    searchAddon: addon,
    terminal: {
      element: terminalElement,
      focus: paneFocus,
      getSelection: vi.fn(() => '')
    }
  }
  const manager = {
    getActivePane: () => pane,
    getPanes: () => [pane]
  } as unknown as PaneManager
  const transport = {
    getPtyId: () => 'pty-1',
    sendInput: vi.fn(() => true)
  } as unknown as PtyTransport
  const deps: KeyboardHandlersDeps = {
    tabId: 'tab-1',
    worktreeId: 'worktree-1',
    isActive: true,
    keyboardScopeRef: { current: scope },
    managerRef: { current: manager },
    paneTransportsRef: { current: new Map([[pane.id, transport]]) },
    panePtyBindingsRef: { current: new Map() },
    paneCwdRef: { current: new Map() },
    fallbackCwd: '',
    expandedPaneIdRef: { current: null },
    setExpandedPane: vi.fn(),
    restoreExpandedLayout: vi.fn(),
    refreshPaneSizes: vi.fn(),
    persistLayoutSnapshot: vi.fn(),
    toggleExpandPane: vi.fn(),
    setSearchOpen: vi.fn(),
    onSearchSelectedText: vi.fn(),
    onRequestClosePane: vi.fn(),
    onClearPaneScrollback: vi.fn(),
    onSetTitle: vi.fn(),
    onClearPaneTitle: vi.fn(),
    searchOpenRef: { current: true },
    searchStateRef,
    macOptionAsAltRef: { current: 'false' }
  }
  renderHook(() => useTerminalKeyboardShortcuts(deps))
  vi.mocked(addon.findNext).mockClear()
  vi.mocked(addon.findPrevious).mockClear()
  vi.mocked(addon.clearDecorations).mockClear()

  return {
    addon,
    input: view.getByPlaceholderText('Search...'),
    paneFocus,
    shortcutTarget
  }
}

beforeEach(() => vi.useFakeTimers())

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

it.each([
  ['Cmd+G', 'Mac', { metaKey: true }, 'next'],
  ['Cmd+Shift+G', 'Mac', { metaKey: true, shiftKey: true }, 'previous'],
  ['Ctrl+G', 'Linux', { ctrlKey: true }, 'next'],
  ['Ctrl+Shift+G', 'Linux', { ctrlKey: true, shiftKey: true }, 'previous']
])(
  'flushes pending search before captured %s navigation',
  (_name, platform, modifiers, direction) => {
    const harness = createHarness(platform)
    fireEvent.change(harness.input, { target: { value: 'needle' } })
    const shortcut = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'g',
      code: 'KeyG',
      ...modifiers
    })

    harness.shortcutTarget.dispatchEvent(shortcut)

    expect(shortcut.defaultPrevented).toBe(true)
    expect(harness.addon.findNext).toHaveBeenNthCalledWith(
      1,
      'needle',
      expect.objectContaining({ incremental: true })
    )
    const navigation = direction === 'next' ? harness.addon.findNext : harness.addon.findPrevious
    const navigationCallIndex = direction === 'next' ? 1 : 0
    expect(vi.mocked(navigation).mock.calls[navigationCallIndex]).toEqual([
      'needle',
      { caseSensitive: false, regex: false }
    ])
    expect(vi.mocked(harness.addon.findNext).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(navigation).mock.invocationCallOrder[navigationCallIndex]
    )
    const findNextCalls = vi.mocked(harness.addon.findNext).mock.calls.length

    act(() => vi.advanceTimersByTime(75))
    expect(harness.addon.findNext).toHaveBeenCalledTimes(findNextCalls)
    expect(harness.paneFocus).toHaveBeenCalledTimes(1)
  }
)
