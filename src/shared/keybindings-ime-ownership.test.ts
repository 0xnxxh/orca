// The shortcut matcher is the one place every dispatcher agrees on, so it is where IME
// ownership is decided. Guarding the window listeners individually does not hold: they are
// capture-phase siblings on `window`, returning early from one does not stop the others, and
// the terminal's guard deliberately does not preventDefault (the IME still needs the key).
//
// The concrete failure this pins: a composing Mod+Alt+W resolved `tab.closeAll` in the
// Terminal dispatcher and closed every editor tab in the worktree mid-preedit.

import { describe, expect, it } from 'vitest'
import {
  keybindingInputIsImeOwned,
  keybindingMatchesAction,
  matchKeybindingDigitIndex,
  type KeybindingInput
} from './keybindings'

const TERMINAL_CONTEXT = { context: 'terminal', terminalShortcutPolicy: 'orca-first' } as const

const closeAllTabs = (over: Partial<KeybindingInput> = {}): KeybindingInput => ({
  key: 'w',
  code: 'KeyW',
  metaKey: true,
  altKey: true,
  ctrlKey: false,
  shiftKey: false,
  ...over
})

describe('keybindingInputIsImeOwned', () => {
  it.each([
    ['isComposing', { key: 'w', isComposing: true }],
    ['keyCode 229', { key: 'w', keyCode: 229 }],
    ['the Process key', { key: 'Process' }]
  ])('recognizes %s', (_marker, input) => {
    expect(keybindingInputIsImeOwned(input)).toBe(true)
  })

  it('leaves an ordinary keystroke alone', () => {
    expect(keybindingInputIsImeOwned({ key: 'w', keyCode: 87, isComposing: false })).toBe(false)
  })
})

describe('keybindingMatchesAction refuses input an IME owns', () => {
  it('matches a destructive chord the user actually pressed', () => {
    expect(
      keybindingMatchesAction('tab.closeAll', closeAllTabs(), 'darwin', undefined, TERMINAL_CONTEXT)
    ).toBe(true)
  })

  // Regression: this returned true, and Terminal.tsx's capture listener called
  // handleCloseAllFiles() while the user was mid-composition.
  it.each([
    ['isComposing', closeAllTabs({ isComposing: true })],
    ['keyCode 229', closeAllTabs({ keyCode: 229 })]
  ])('refuses to close every tab on a chord marked by %s', (_marker, input) => {
    expect(
      keybindingMatchesAction('tab.closeAll', input, 'darwin', undefined, TERMINAL_CONTEXT)
    ).toBe(false)
  })

  it('refuses a marked chord on Windows and Linux too', () => {
    const ctrlAltW = closeAllTabs({ metaKey: false, ctrlKey: true, isComposing: true })
    expect(
      keybindingMatchesAction('tab.closeAll', ctrlAltW, 'win32', undefined, TERMINAL_CONTEXT)
    ).toBe(false)
    expect(
      keybindingMatchesAction('tab.closeAll', ctrlAltW, 'linux', undefined, TERMINAL_CONTEXT)
    ).toBe(false)
  })

  // The terminal resolves first and judges ownership after, because input-source switching
  // and deferred Enter are legitimate mid-composition. Nothing else may set this.
  it('still resolves for a caller that owns the IME decision itself', () => {
    expect(
      keybindingMatchesAction(
        'tab.closeAll',
        closeAllTabs({ isComposing: true }),
        'darwin',
        undefined,
        {
          ...TERMINAL_CONTEXT,
          allowImeOwnedInput: true
        }
      )
    ).toBe(true)
  })
})

describe('matchKeybindingDigitIndex refuses input an IME owns', () => {
  // Cmd+1-9 on macOS.
  const selectWorkspace = (over: Partial<KeybindingInput> = {}): KeybindingInput => ({
    key: '2',
    code: 'Digit2',
    metaKey: true,
    altKey: false,
    ctrlKey: false,
    shiftKey: false,
    ...over
  })

  it('resolves an unmarked digit chord', () => {
    expect(matchKeybindingDigitIndex('workspace.selectByIndex', selectWorkspace(), 'darwin')).toBe(
      1
    )
  })

  // Digits carry an IME meaning of their own (candidate selection), so a marked digit keydown
  // arriving while the modifier is still physically held is a live collision, not a hypothetical.
  it('returns null while the IME owns the digit', () => {
    expect(
      matchKeybindingDigitIndex(
        'workspace.selectByIndex',
        selectWorkspace({ isComposing: true }),
        'darwin'
      )
    ).toBeNull()
  })

  it('still resolves for a caller that owns the IME decision itself', () => {
    expect(
      matchKeybindingDigitIndex(
        'workspace.selectByIndex',
        selectWorkspace({ isComposing: true }),
        'darwin',
        undefined,
        { allowImeOwnedInput: true }
      )
    ).toBe(1)
  })
})
