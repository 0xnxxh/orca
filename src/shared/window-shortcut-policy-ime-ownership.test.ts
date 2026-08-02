import { describe, expect, it } from 'vitest'
import {
  matchesRecentTabSwitcherChord,
  resolveWindowShortcutAction,
  type WindowShortcutInput
} from './window-shortcut-policy'
import type { KeybindingOverrides } from './keybindings'

// `matchesRecentTabSwitcherChord` takes a whole event but hands the matcher a literal it rebuilds
// field-by-field, so the IME markers can go missing one level below a call site that looks
// perfectly safe. That is how it survived the sweep that fixed the four direct adapters.
describe('window shortcut resolution refuses input an IME owns', () => {
  const recentTab: KeybindingOverrides = { 'tab.previousRecent': ['Mod+Tab'] }

  const ctrlTab = (over: Partial<WindowShortcutInput> = {}): WindowShortcutInput => ({
    type: 'keyDown',
    key: 'Tab',
    code: 'Tab',
    control: true,
    ...over
  })

  it('matches a real Ctrl+Tab', () => {
    expect(matchesRecentTabSwitcherChord(ctrlTab(), 'linux', recentTab)).toBe(true)
  })

  it.each([
    ['isComposing', { isComposing: true }],
    ['keyCode 229', { keyCode: 229 }]
  ])('refuses the switcher chord when marked by %s', (_marker, over) => {
    expect(matchesRecentTabSwitcherChord(ctrlTab(over), 'linux', recentTab)).toBe(false)
  })

  // The resolver forwards its input untouched, so this pins that it keeps doing so.
  it('resolves no action for a marked chord', () => {
    const zoomIn: WindowShortcutInput = { key: '=', code: 'Equal', control: true }

    expect(resolveWindowShortcutAction(zoomIn, 'linux')).toEqual({
      type: 'zoom',
      direction: 'in'
    })
    expect(resolveWindowShortcutAction({ ...zoomIn, isComposing: true }, 'linux')).toBeNull()
  })
})
