// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { terminalShortcutIsOwnedByIme } from './terminal-shortcut-composition-guard'

function keydown(init: KeyboardEventInit & { keyCode?: number }): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  if (init.keyCode !== undefined) {
    Object.defineProperty(event, 'keyCode', { value: init.keyCode })
  }
  return event
}

const sendInput = (): { type: string } => ({ type: 'sendInput' })
const switchInputSource = (): { type: string } => ({ type: 'switchInputSource' })
const noAction = (): null => null

describe('terminalShortcutIsOwnedByIme', () => {
  it.each([
    ['isComposing', { key: 'Backspace', code: 'Backspace', ctrlKey: true, isComposing: true }],
    ['keyCode 229', { key: 'Backspace', code: 'Backspace', ctrlKey: true, keyCode: 229 }],
    ['key Process', { key: 'Process', code: 'KeyW', ctrlKey: true }]
  ])('claims a chord marked by %s', (_marker, init) => {
    expect(terminalShortcutIsOwnedByIme(keydown(init), sendInput)).toBe(true)
  })

  it('leaves an unmarked chord alone', () => {
    const event = keydown({ key: 'Backspace', code: 'Backspace', ctrlKey: true, keyCode: 8 })
    expect(terminalShortcutIsOwnedByIme(event, sendInput)).toBe(false)
  })

  // Both exemptions matter in the same direction: claiming them would break a path that
  // already handles composition, rather than merely declining to fix one.
  it('releases Enter for a caller that defers it to the commit', () => {
    const event = keydown({ key: 'Process', code: 'Enter', keyCode: 229, isComposing: true })
    expect(terminalShortcutIsOwnedByIme(event, sendInput, { enterIsDeferredToCommit: true })).toBe(
      false
    )
  })

  it('claims Enter for a caller with no defer path, so it commits instead of submitting', () => {
    const event = keydown({ key: 'Process', code: 'Enter', keyCode: 229, isComposing: true })
    expect(terminalShortcutIsOwnedByIme(event, sendInput)).toBe(true)
  })

  it('releases the input-source switch so the OS still receives it', () => {
    const event = keydown({ key: 'Process', code: 'Space', ctrlKey: true, keyCode: 229 })
    expect(terminalShortcutIsOwnedByIme(event, switchInputSource)).toBe(false)
  })

  it('claims a marked chord that resolves to nothing, so no later matcher sees it', () => {
    const event = keydown({ key: 'Process', code: 'KeyF', ctrlKey: true, keyCode: 229 })
    expect(terminalShortcutIsOwnedByIme(event, noAction)).toBe(true)
  })
})
