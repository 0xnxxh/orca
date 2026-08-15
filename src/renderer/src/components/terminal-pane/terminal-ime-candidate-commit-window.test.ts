// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { installTerminalImeCandidateCommitWindow } from './terminal-ime-candidate-commit-window'
import { TERMINAL_IME_CANDIDATE_GUARD_POST_COMPOSITION_MS } from './terminal-ime-composition-tracker'
import type { XtermBypassEvent } from './xterm-bypass-policy'

function event(overrides: Partial<XtermBypassEvent>): XtermBypassEvent {
  return {
    type: 'keydown',
    key: '',
    code: '',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides
  }
}

function installWindow(): {
  element: HTMLElement
  advance: (milliseconds: number) => void
  commitWindow: ReturnType<typeof installTerminalImeCandidateCommitWindow>
  now: () => number
  compositionEnd: () => void
} {
  const element = document.createElement('div')
  document.body.appendChild(element)
  let clock = 1_000
  const commitWindow = installTerminalImeCandidateCommitWindow({
    terminalElement: element,
    now: () => clock
  })
  return {
    element,
    commitWindow,
    now: () => clock,
    advance: (milliseconds) => {
      clock += milliseconds
    },
    compositionEnd: () => {
      element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    }
  }
}

/** Feeds an event through the same classify-then-observe order the pane uses. */
function handle(
  harness: ReturnType<typeof installWindow>,
  keyboardEvent: XtermBypassEvent
): boolean {
  const absorbed = harness.commitWindow.shouldAbsorbKeyEvent(keyboardEvent, harness.now())
  harness.commitWindow.observeKeyboardEvent(keyboardEvent)
  return absorbed
}

describe('installTerminalImeCandidateCommitWindow', () => {
  it('absorbs the recorded IBus trailing bare digit release after a candidate commit', () => {
    const harness = installWindow()
    // The recorded IBus shape: the selector keydown is Process/229 on the digit's
    // physical key, and only its release comes back as a bare digit.
    expect(
      handle(harness, event({ key: 'Process', code: 'Digit1', keyCode: 229, isComposing: true }))
    ).toBe(false)
    harness.compositionEnd()
    expect(handle(harness, event({ type: 'keyup', key: '1', code: 'Digit1', keyCode: 49 }))).toBe(
      true
    )
    harness.commitWindow.dispose()
  })

  it('absorbs a trailing bare Space release after a Space-committed candidate', () => {
    const harness = installWindow()
    handle(harness, event({ key: 'Process', code: 'Space', keyCode: 229, isComposing: true }))
    harness.compositionEnd()
    expect(handle(harness, event({ type: 'keyup', key: ' ', code: 'Space', keyCode: 32 }))).toBe(
      true
    )
    harness.commitWindow.dispose()
  })

  it('leaves a fresh press of the same key alone so real typing still reaches the pty', () => {
    const harness = installWindow()
    handle(harness, event({ key: 'Process', code: 'Space', keyCode: 229, isComposing: true }))
    harness.compositionEnd()
    handle(harness, event({ type: 'keyup', key: ' ', code: 'Space', keyCode: 32 }))
    expect(handle(harness, event({ key: ' ', code: 'Space', keyCode: 32 }))).toBe(false)
    harness.commitWindow.dispose()
  })

  it('does not arm when the composition was committed by a non-candidate key', () => {
    const harness = installWindow()
    handle(harness, event({ key: 'Process', code: 'Enter', keyCode: 229, isComposing: true }))
    harness.compositionEnd()
    expect(handle(harness, event({ type: 'keyup', key: '1', code: 'Digit1', keyCode: 49 }))).toBe(
      false
    )
    harness.commitWindow.dispose()
  })

  it('does not arm from an ordinary digit press that was never IME-owned', () => {
    const harness = installWindow()
    handle(harness, event({ key: '1', code: 'Digit1', keyCode: 49 }))
    harness.compositionEnd()
    expect(handle(harness, event({ type: 'keyup', key: '1', code: 'Digit1', keyCode: 49 }))).toBe(
      false
    )
    harness.commitWindow.dispose()
  })

  it('does not arm once the selector was already released before the composition ended', () => {
    const harness = installWindow()
    handle(harness, event({ key: 'Process', code: 'Digit1', keyCode: 229, isComposing: true }))
    handle(harness, event({ type: 'keyup', key: '1', code: 'Digit1', keyCode: 49 }))
    harness.compositionEnd()
    expect(handle(harness, event({ type: 'keyup', key: '1', code: 'Digit1', keyCode: 49 }))).toBe(
      false
    )
    harness.commitWindow.dispose()
  })

  it('expires so a later bare digit is never dead', () => {
    const harness = installWindow()
    handle(harness, event({ key: 'Process', code: 'Digit1', keyCode: 229, isComposing: true }))
    harness.compositionEnd()
    harness.advance(TERMINAL_IME_CANDIDATE_GUARD_POST_COMPOSITION_MS + 1)
    expect(
      handle(harness, event({ type: 'keypress', key: '1', code: 'Digit1', keyCode: 49 }))
    ).toBe(false)
    harness.commitWindow.dispose()
  })

  it('drops its state on blur', () => {
    const harness = installWindow()
    handle(harness, event({ key: 'Process', code: 'Digit1', keyCode: 229, isComposing: true }))
    harness.compositionEnd()
    harness.element.dispatchEvent(new FocusEvent('blur', { bubbles: true }))
    expect(handle(harness, event({ type: 'keyup', key: '1', code: 'Digit1', keyCode: 49 }))).toBe(
      false
    )
    harness.commitWindow.dispose()
  })

  it('handles a missing terminal element', () => {
    const commitWindow = installTerminalImeCandidateCommitWindow({ terminalElement: null })
    expect(
      commitWindow.shouldAbsorbKeyEvent(event({ type: 'keyup', key: '1', code: 'Digit1' }), 0)
    ).toBe(false)
    expect(() => commitWindow.dispose()).not.toThrow()
  })
})
