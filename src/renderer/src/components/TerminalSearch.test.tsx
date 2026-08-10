// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type { SearchAddon } from '@xterm/addon-search'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { matchSearchNavigate, type SearchState } from '@/components/terminal-pane/keyboard-handlers'
import TerminalSearch from './TerminalSearch'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

beforeEach(() => vi.useFakeTimers())

afterEach(() => {
  cleanup()
  vi.clearAllTimers()
  vi.useRealTimers()
})

function createSearchAddon(): SearchAddon {
  return {
    findNext: vi.fn(() => true),
    findPrevious: vi.fn(() => true),
    clearDecorations: vi.fn()
  } as unknown as SearchAddon
}

function clearAddonMocks(addon: SearchAddon): void {
  vi.mocked(addon.findNext).mockClear()
  vi.mocked(addon.findPrevious).mockClear()
  vi.mocked(addon.clearDecorations).mockClear()
}

function advanceSearchDebounce(): void {
  act(() => vi.advanceTimersByTime(75))
}

function renderSearch(
  searchAddon: SearchAddon,
  searchStateRef: React.RefObject<SearchState> = {
    current: { query: '', caseSensitive: false, regex: false }
  }
): ReturnType<typeof render> {
  return render(
    <TerminalSearch
      isOpen
      onClose={vi.fn()}
      searchAddon={searchAddon}
      searchStateRef={searchStateRef}
    />
  )
}

describe('TerminalSearch debounce', () => {
  it('runs one search with the latest query after a typing burst', () => {
    const addon = createSearchAddon()
    const view = renderSearch(addon)
    const input = view.getByPlaceholderText('Search...')
    clearAddonMocks(addon)

    fireEvent.change(input, { target: { value: 'n' } })
    act(() => vi.advanceTimersByTime(30))
    fireEvent.change(input, { target: { value: 'nee' } })
    act(() => vi.advanceTimersByTime(30))
    fireEvent.change(input, { target: { value: 'needle' } })

    act(() => vi.advanceTimersByTime(74))
    expect(addon.findNext).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(1))
    expect(addon.findNext).toHaveBeenCalledTimes(1)
    expect(addon.findNext).toHaveBeenCalledWith(
      'needle',
      expect.objectContaining({ caseSensitive: false, regex: false, incremental: true })
    )
  })

  it('updates shortcut search state on every input change before the debounce', () => {
    const addon = createSearchAddon()
    const searchStateRef = {
      current: { query: '', caseSensitive: false, regex: false }
    }
    const view = renderSearch(addon, searchStateRef)
    const input = view.getByPlaceholderText('Search...')

    fireEvent.change(input, { target: { value: 'n' } })
    expect(searchStateRef.current).toEqual({ query: 'n', caseSensitive: false, regex: false })
    fireEvent.change(input, { target: { value: 'needle' } })
    expect(searchStateRef.current).toEqual({ query: 'needle', caseSensitive: false, regex: false })
  })

  it.each([
    ['macOS', true, { metaKey: true, ctrlKey: false }],
    ['Linux/Windows', false, { metaKey: false, ctrlKey: true }]
  ])('exposes the pending query to %s search navigation', (_platform, isMac, modifiers) => {
    const addon = createSearchAddon()
    const searchStateRef = {
      current: { query: '', caseSensitive: false, regex: false }
    }
    const view = renderSearch(addon, searchStateRef)
    fireEvent.change(view.getByPlaceholderText('Search...'), { target: { value: 'needle' } })

    expect(
      matchSearchNavigate(
        { key: 'g', shiftKey: false, altKey: false, ...modifiers },
        isMac,
        true,
        searchStateRef.current
      )
    ).toBe('next')
  })

  it('flushes an armed search on Enter and does not rerun its timer', () => {
    const addon = createSearchAddon()
    const view = renderSearch(addon)
    const input = view.getByPlaceholderText('Search...')
    clearAddonMocks(addon)

    fireEvent.change(input, { target: { value: 'needle' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(addon.findNext).toHaveBeenCalledTimes(2)
    expect(addon.findNext).toHaveBeenNthCalledWith(
      1,
      'needle',
      expect.objectContaining({ incremental: true })
    )
    expect(addon.findNext).toHaveBeenNthCalledWith(
      2,
      'needle',
      expect.objectContaining({ incremental: false })
    )

    advanceSearchDebounce()
    expect(addon.findNext).toHaveBeenCalledTimes(2)
  })

  it('flushes before Shift+Enter navigates to the previous match', () => {
    const addon = createSearchAddon()
    const view = renderSearch(addon)
    const input = view.getByPlaceholderText('Search...')
    clearAddonMocks(addon)

    fireEvent.change(input, { target: { value: 'needle' } })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })

    expect(addon.findNext).toHaveBeenCalledTimes(1)
    expect(addon.findNext).toHaveBeenCalledWith(
      'needle',
      expect.objectContaining({ incremental: true })
    )
    expect(addon.findPrevious).toHaveBeenCalledWith(
      'needle',
      expect.objectContaining({ incremental: false })
    )
  })

  it('restarts an armed search with the latest option values', () => {
    const addon = createSearchAddon()
    const view = renderSearch(addon)
    const input = view.getByPlaceholderText('Search...')
    clearAddonMocks(addon)

    fireEvent.change(input, { target: { value: 'needle' } })
    fireEvent.click(view.getByTitle('Case sensitive'))
    fireEvent.click(view.getByTitle('Regex'))
    advanceSearchDebounce()

    expect(addon.findNext).toHaveBeenCalledTimes(1)
    expect(addon.findNext).toHaveBeenCalledWith(
      'needle',
      expect.objectContaining({ caseSensitive: true, regex: true, incremental: true })
    )
  })
})

describe('TerminalSearch cleanup', () => {
  it('clears immediately when the query is erased and cancels its search', () => {
    const addon = createSearchAddon()
    const view = renderSearch(addon)
    const input = view.getByPlaceholderText('Search...')
    clearAddonMocks(addon)

    fireEvent.change(input, { target: { value: 'needle' } })
    fireEvent.change(input, { target: { value: '' } })

    expect(addon.clearDecorations).toHaveBeenCalledTimes(1)
    expect(addon.findNext).toHaveBeenCalledWith('')
    advanceSearchDebounce()
    expect(addon.findNext).toHaveBeenCalledTimes(1)
  })

  it('clears immediately when the search closes', () => {
    const addon = createSearchAddon()
    const searchStateRef = {
      current: { query: '', caseSensitive: false, regex: false }
    }
    const view = renderSearch(addon, searchStateRef)
    fireEvent.change(view.getByPlaceholderText('Search...'), { target: { value: 'needle' } })
    clearAddonMocks(addon)

    view.rerender(
      <TerminalSearch
        isOpen={false}
        onClose={vi.fn()}
        searchAddon={addon}
        searchStateRef={searchStateRef}
      />
    )

    expect(addon.clearDecorations).toHaveBeenCalledTimes(1)
    expect(addon.findNext).toHaveBeenCalledWith('')
    advanceSearchDebounce()
    expect(addon.findNext).toHaveBeenCalledTimes(1)
  })

  it('clears the previous addon and does not run its armed search after a pane swap', () => {
    const previousAddon = createSearchAddon()
    const nextAddon = createSearchAddon()
    const searchStateRef = {
      current: { query: '', caseSensitive: false, regex: false }
    }
    const view = renderSearch(previousAddon, searchStateRef)
    fireEvent.change(view.getByPlaceholderText('Search...'), { target: { value: 'needle' } })
    clearAddonMocks(previousAddon)

    view.rerender(
      <TerminalSearch
        isOpen
        onClose={vi.fn()}
        searchAddon={nextAddon}
        searchStateRef={searchStateRef}
      />
    )

    expect(previousAddon.clearDecorations).toHaveBeenCalledTimes(1)
    expect(previousAddon.findNext).toHaveBeenCalledWith('')
    advanceSearchDebounce()
    expect(previousAddon.findNext).toHaveBeenCalledTimes(1)
    expect(nextAddon.findNext).toHaveBeenCalledWith(
      'needle',
      expect.objectContaining({ incremental: true })
    )
  })

  it('clears the addon and cancels the armed search on unmount', () => {
    const addon = createSearchAddon()
    const view = renderSearch(addon)
    fireEvent.change(view.getByPlaceholderText('Search...'), { target: { value: 'needle' } })
    clearAddonMocks(addon)

    view.unmount()

    expect(addon.clearDecorations).toHaveBeenCalledTimes(1)
    expect(addon.findNext).toHaveBeenCalledWith('')
    advanceSearchDebounce()
    expect(addon.findNext).toHaveBeenCalledTimes(1)
  })
})
