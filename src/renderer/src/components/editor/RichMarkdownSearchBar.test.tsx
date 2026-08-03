// @vitest-environment happy-dom

import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RichMarkdownSearchBar } from './RichMarkdownSearchBar'

vi.mock('@/hooks/useShortcutLabel', () => ({ useOptionalShortcutLabel: () => null }))
vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

afterEach(cleanup)

function renderBar() {
  const actions = {
    onClose: vi.fn(),
    onMoveToMatch: vi.fn(),
    onQueryChange: vi.fn(),
    onReplaceAll: vi.fn(),
    onReplaceCurrent: vi.fn(),
    onReplaceQueryChange: vi.fn(),
    onToggleMatchCase: vi.fn(),
    onToggleReplaceMode: vi.fn(),
    onToggleWholeWord: vi.fn()
  }
  const view = render(
    <RichMarkdownSearchBar
      activeMatchIndex={0}
      isOpen
      isReplaceMode
      matchCase={false}
      matchCount={2}
      query="needle"
      replaceQuery="replacement"
      replaceDisabled={false}
      searchInputRef={{ current: null }}
      wholeWord={false}
      {...actions}
    />
  )
  return { actions, view }
}

describe('RichMarkdownSearchBar IME ownership', () => {
  it('withholds marked search-field keys and preserves ordinary navigation and close', () => {
    const { actions, view } = renderBar()
    const input = view.getByLabelText('Find in rich markdown editor')

    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', keyCode: 13, isComposing: true })
    fireEvent.keyDown(input, { key: 'Escape', code: 'Escape', keyCode: 27, isComposing: true })
    expect(actions.onMoveToMatch).not.toHaveBeenCalled()
    expect(actions.onClose).not.toHaveBeenCalled()

    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', keyCode: 13 })
    fireEvent.keyDown(input, { key: 'Escape', code: 'Escape', keyCode: 27 })
    expect(actions.onMoveToMatch).toHaveBeenCalledWith(1)
    expect(actions.onClose).toHaveBeenCalledTimes(1)
  })

  it('withholds marked replace-field keys and preserves ordinary replace and close', () => {
    const { actions, view } = renderBar()
    const input = view.getByLabelText('Replace in rich markdown editor')

    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', keyCode: 13, isComposing: true })
    fireEvent.keyDown(input, { key: 'Escape', code: 'Escape', keyCode: 27, isComposing: true })
    expect(actions.onReplaceCurrent).not.toHaveBeenCalled()
    expect(actions.onClose).not.toHaveBeenCalled()

    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', keyCode: 13 })
    fireEvent.keyDown(input, { key: 'Escape', code: 'Escape', keyCode: 27 })
    expect(actions.onReplaceCurrent).toHaveBeenCalledTimes(1)
    expect(actions.onClose).toHaveBeenCalledTimes(1)
  })
})
