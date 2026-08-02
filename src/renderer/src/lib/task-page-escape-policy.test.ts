// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { resolveTaskPageEscapeAction } from './task-page-escape-policy'

function escape(init: { isComposing?: boolean; keyCode?: number; key?: string } = {}): {
  key: string
  keyCode: number
  isComposing: boolean
} {
  return {
    key: init.key ?? 'Escape',
    keyCode: init.keyCode ?? 27,
    isComposing: init.isComposing ?? false
  }
}

describe('resolveTaskPageEscapeAction', () => {
  it('closes the page when focus is outside a field', () => {
    expect(resolveTaskPageEscapeAction(escape(), document.createElement('div'))).toBe('close-page')
  })

  it.each([
    ['input', () => document.createElement('input')],
    ['textarea', () => document.createElement('textarea')],
    ['select', () => document.createElement('select')]
  ])('blurs a focused %s instead of closing the page', (_name, create) => {
    expect(resolveTaskPageEscapeAction(escape(), create())).toBe('blur-target')
  })

  it('blurs a contenteditable host', () => {
    const target = document.createElement('div')
    target.contentEditable = 'true'
    Object.defineProperty(target, 'isContentEditable', { value: true })
    expect(resolveTaskPageEscapeAction(escape(), target)).toBe('blur-target')
  })

  // The listener is in the capture phase, so it sees the candidate-window Escape before the
  // composing input does. Blurring here would end the composition the user meant to keep.
  it.each([
    ['isComposing', escape({ isComposing: true })],
    ['keyCode 229', escape({ keyCode: 229 })]
  ])('ignores an Escape marked by %s while a field has focus', (_marker, event) => {
    expect(resolveTaskPageEscapeAction(event, document.createElement('input'))).toBe('ignore')
  })

  it('ignores a key that is not Escape', () => {
    expect(
      resolveTaskPageEscapeAction(escape({ key: 'Enter' }), document.createElement('div'))
    ).toBe('ignore')
  })

  it('ignores an event with no element target', () => {
    expect(resolveTaskPageEscapeAction(escape(), null)).toBe('ignore')
  })
})
