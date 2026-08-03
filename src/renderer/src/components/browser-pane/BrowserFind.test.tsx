// @vitest-environment happy-dom

import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import BrowserFind from './BrowserFind'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

afterEach(cleanup)

function renderFind() {
  const onClose = vi.fn()
  const webview = {
    addEventListener: vi.fn(),
    findInPage: vi.fn(),
    removeEventListener: vi.fn(),
    stopFindInPage: vi.fn()
  }
  const view = render(
    <BrowserFind
      isOpen
      onClose={onClose}
      webviewRef={{ current: webview as unknown as Electron.WebviewTag }}
    />
  )
  return { input: view.getByPlaceholderText('Find in page...'), onClose, view, webview }
}

describe('BrowserFind IME ownership', () => {
  it('leaves find open for a marked Escape and closes it for an ordinary Escape', () => {
    const { input, onClose } = renderFind()

    fireEvent.keyDown(input, { key: 'Escape', code: 'Escape', keyCode: 27, isComposing: true })
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.keyDown(input, { key: 'Escape', code: 'Escape', keyCode: 27 })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not navigate on a marked Enter and preserves ordinary Enter navigation', () => {
    const { input, webview } = renderFind()
    fireEvent.change(input, { target: { value: 'needle' } })
    webview.findInPage.mockClear()

    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', keyCode: 13, isComposing: true })
    expect(webview.findInPage).not.toHaveBeenCalled()

    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', keyCode: 13 })
    expect(webview.findInPage).toHaveBeenCalledTimes(1)
  })
})
