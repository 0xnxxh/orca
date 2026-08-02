// @vitest-environment happy-dom
//
// `terminalShortcutIsOwnedByIme` returning true makes the window handler `return` without
// preventDefault, so the keystroke keeps propagating — the IME still needs it. That is only
// safe because the pane's own xterm handler withholds the same event from xterm's `_keyDown`
// (use-terminal-pane-lifecycle.ts calls this policy and returns false on suppression, which
// short-circuits xterm ahead of CompositionHelper and the CR emission).
//
// Nothing in either module states that dependency, so this pins it: every Enter shape the
// guard claims must also be one the bypass policy suppresses. Loosen either side and a
// composing Enter chord reaches the PTY and submits the half-typed command.

import { describe, expect, it } from 'vitest'
import {
  shouldSuppressTerminalImeKeyboardEvent,
  type XtermBypassEvent
} from './xterm-bypass-policy'
import { terminalShortcutIsOwnedByIme } from './terminal-shortcut-composition-guard'

type Platform = { isMac: boolean; isLinux: boolean }

const MAC: Platform = { isMac: true, isLinux: false }
const WINDOWS: Platform = { isMac: false, isLinux: false }
const LINUX: Platform = { isMac: false, isLinux: true }

// A chord bound to something other than sendInput is the case the guard now claims rather
// than exempting, so it is the case whose propagation has to be provably harmless.
const EXPAND_PANE_CHORD = { type: 'keydown', code: 'Enter', ctrlKey: true, shiftKey: true }

const CLAIMED_ENTER_SHAPES: { name: string; platform: Platform; event: XtermBypassEvent }[] = [
  {
    name: 'marked-real Enter (isComposing)',
    platform: MAC,
    event: {
      ...EXPAND_PANE_CHORD,
      key: 'Enter',
      keyCode: 13,
      isComposing: true,
      metaKey: false,
      altKey: false
    } as XtermBypassEvent
  },
  {
    name: 'Windows Process Enter',
    platform: WINDOWS,
    event: {
      ...EXPAND_PANE_CHORD,
      key: 'Process',
      keyCode: 229,
      isComposing: false,
      metaKey: false,
      altKey: false
    } as XtermBypassEvent
  },
  {
    name: 'Linux composing Enter',
    platform: LINUX,
    event: {
      ...EXPAND_PANE_CHORD,
      key: 'Enter',
      keyCode: 13,
      isComposing: true,
      metaKey: false,
      altKey: false
    } as XtermBypassEvent
  }
]

describe('the shortcut guard only claims Enter shapes xterm never sees', () => {
  const expandPane = { type: 'toggleExpandActivePane' } as const

  it.each(CLAIMED_ENTER_SHAPES)('$name', ({ platform, event }) => {
    const claimed = terminalShortcutIsOwnedByIme(
      event as unknown as KeyboardEvent,
      () => expandPane,
      { enterIsDeferredToCommit: true }
    )
    expect(claimed).toBe(true)

    expect(
      shouldSuppressTerminalImeKeyboardEvent(event, {
        compositionActive: true,
        candidateKeyGuardActive: false,
        pendingCandidateKeyReleaseActive: false,
        ...platform
      })
    ).toBe(true)
  })

  it('leaves an unmarked Enter chord to the ordinary dispatch on both sides', () => {
    const event = {
      ...EXPAND_PANE_CHORD,
      key: 'Enter',
      keyCode: 13,
      isComposing: false,
      metaKey: false,
      altKey: false
    } as XtermBypassEvent

    expect(
      terminalShortcutIsOwnedByIme(event as unknown as KeyboardEvent, () => expandPane, {
        enterIsDeferredToCommit: true
      })
    ).toBe(false)
    expect(
      shouldSuppressTerminalImeKeyboardEvent(event, {
        compositionActive: false,
        candidateKeyGuardActive: false,
        pendingCandidateKeyReleaseActive: false,
        ...MAC
      })
    ).toBe(false)
  })
})
