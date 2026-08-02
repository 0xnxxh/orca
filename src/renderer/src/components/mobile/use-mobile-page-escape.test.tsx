// @vitest-environment happy-dom

import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMobilePageEscape } from './use-mobile-page-escape'

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
})

describe('useMobilePageEscape', () => {
  it('leaves a composing input focused for marked Escape', () => {
    const onClose = vi.fn()
    const input = document.createElement('input')
    document.body.append(input)
    renderHook(() => useMobilePageEscape(onClose))
    input.focus()

    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, isComposing: true })
    )

    expect(document.activeElement).toBe(input)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('still blurs a focused input for ordinary Escape', () => {
    const onClose = vi.fn()
    const input = document.createElement('input')
    document.body.append(input)
    renderHook(() => useMobilePageEscape(onClose))
    input.focus()

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    expect(document.activeElement).not.toBe(input)
    expect(onClose).not.toHaveBeenCalled()
  })
})
