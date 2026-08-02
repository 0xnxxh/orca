// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import {
  resolveTaskPageEscapeAction,
  resolveTaskPageSearchShortcut
} from './task-page-window-shortcut-policy'

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

describe('resolveTaskPageSearchShortcut', () => {
  const findChord = (
    over: Partial<{ isComposing: boolean; keyCode: number; key: string }> = {}
  ): Parameters<typeof resolveTaskPageSearchShortcut>[0] => ({
    key: over.key ?? 'f',
    keyCode: over.keyCode ?? 70,
    isComposing: over.isComposing ?? false,
    metaKey: true,
    ctrlKey: false,
    altKey: false,
    shiftKey: false
  })
  const search = (): HTMLInputElement => document.createElement('input')

  it('focuses the search input on Mod+F from outside a field', () => {
    const input = search()
    expect(
      resolveTaskPageSearchShortcut(findChord(), document.createElement('div'), input, {
        isMac: true
      })
    ).toBe('focus-search')
  })

  it('re-selects when the search input itself already has focus', () => {
    const input = search()
    expect(resolveTaskPageSearchShortcut(findChord(), input, input, { isMac: true })).toBe(
      'focus-search'
    )
  })

  // The search input is exempt from the editable bail-out, so without the IME check a
  // composing user pressing the chord has their preedit torn down by focus/select.
  it.each([
    ['isComposing', findChord({ isComposing: true })],
    ['keyCode 229', findChord({ keyCode: 229 })],
    ['a Process key', findChord({ key: 'Process', keyCode: 229 })]
  ])('ignores a find chord marked by %s while composing in the search input', (_marker, event) => {
    const input = search()
    expect(resolveTaskPageSearchShortcut(event, input, input, { isMac: true })).toBe('ignore')
  })

  it('ignores the chord while another text field has focus', () => {
    expect(
      resolveTaskPageSearchShortcut(findChord(), document.createElement('textarea'), search(), {
        isMac: true
      })
    ).toBe('ignore')
  })

  it('ignores the chord when no search input is mounted', () => {
    expect(
      resolveTaskPageSearchShortcut(findChord(), document.createElement('div'), null, {
        isMac: true
      })
    ).toBe('ignore')
  })

  it('reads Ctrl rather than Meta off Mac', () => {
    const input = search()
    const target = document.createElement('div')
    expect(resolveTaskPageSearchShortcut(findChord(), target, input, { isMac: false })).toBe(
      'ignore'
    )
    expect(
      resolveTaskPageSearchShortcut(
        { ...findChord(), metaKey: false, ctrlKey: true },
        target,
        input,
        { isMac: false }
      )
    ).toBe('focus-search')
  })
})
