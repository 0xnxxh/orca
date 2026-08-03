// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useRichMarkdownSearch } from './useRichMarkdownSearch'

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
})

describe('useRichMarkdownSearch IME ownership', () => {
  it('keeps search open for a marked Escape and closes it for an ordinary Escape', () => {
    const root = document.createElement('div')
    const input = document.createElement('input')
    root.appendChild(input)
    document.body.appendChild(root)
    const { result } = renderHook(() =>
      useRichMarkdownSearch({
        editor: null,
        rootRef: { current: root },
        scrollContainerRef: { current: null }
      })
    )
    act(() => {
      result.current.openSearch()
      ;(result.current.searchState.searchInputRef as { current: HTMLInputElement | null }).current =
        input
    })
    expect(result.current.searchState.isSearchOpen).toBe(true)

    act(() => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          code: 'Escape',
          keyCode: 27,
          isComposing: true,
          bubbles: true
        })
      )
    })
    expect(result.current.searchState.isSearchOpen).toBe(true)

    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(result.current.searchState.isSearchOpen).toBe(false)
  })
})
