// @vitest-environment happy-dom

import { cleanup, fireEvent, render } from '@testing-library/react'
import type { EventBus } from 'pdfjs-dist/web/pdf_viewer.mjs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PdfFind from './PdfFind'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

afterEach(cleanup)

function renderFind() {
  const onClose = vi.fn()
  const eventBus = { dispatch: vi.fn(), off: vi.fn(), on: vi.fn() }
  const view = render(
    <PdfFind
      isOpen
      onClose={onClose}
      eventBusRef={{ current: eventBus as unknown as InstanceType<typeof EventBus> }}
    />
  )
  return { eventBus, input: view.getByPlaceholderText('Find in page...'), onClose }
}

describe('PdfFind IME ownership', () => {
  it('leaves find open for a marked Escape and closes it for an ordinary Escape', () => {
    const { input, onClose } = renderFind()

    fireEvent.keyDown(input, { key: 'Escape', code: 'Escape', keyCode: 27, isComposing: true })
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.keyDown(input, { key: 'Escape', code: 'Escape', keyCode: 27 })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not navigate on a marked Enter and preserves ordinary Enter navigation', () => {
    const { eventBus, input } = renderFind()
    fireEvent.change(input, { target: { value: 'needle' } })
    eventBus.dispatch.mockClear()

    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', keyCode: 13, isComposing: true })
    expect(eventBus.dispatch).not.toHaveBeenCalled()

    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', keyCode: 13 })
    expect(eventBus.dispatch).toHaveBeenCalledTimes(1)
  })
})
