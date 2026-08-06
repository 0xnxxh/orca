// @vitest-environment happy-dom
// HAZARD PIN — owns no reported row. Read this before treating it as a regression guard.
//
// xterm's CompositionHelper.keydown exempts keyCode 16/17/18 (Shift/Ctrl/Alt) and
// 20/229 from tearing down a live composition. macOS Meta is 91/93/224 and is NOT in
// that set, so a Cmd press mid-composition reaches _finalizeComposition(false), which
// drops the compositionView's `active` class. The overlay never recovers, because the
// IME does not re-fire compositionstart — the rest of the word composes with no visible
// preedit. Linux/Windows users press Ctrl (17) and are exempt; macOS users are not.
//
// Three things a future reader must not misread:
//   1. No reporter has filed this. It matched no open row: every candidate is bound to a
//      version window, and this is version-NEUTRAL — defective on both 1.4.162 (pristine
//      beta.287) and 1.4.163 (patched), in different shapes.
//   2. The branch is unexercised in all 328 recorded IME traces. Every keydown ever
//      captured during composition is either 229 or Shift/16, so the exemption set covers
//      the whole corpus and nothing observed reaches the teardown.
//   3. Only the teardown is asserted. A Cmd press also makes the syllable commit twice,
//      but that depends on the IME delivering a later compositionend for a composition it
//      kept alive across the Cmd — normal IME behavior, yet unverified on hardware, since
//      no capture contains this gesture. Deliberately not pinned.
import { Terminal } from '@xterm/xterm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function nextEventLoop(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0))
}

type Harness = {
  compositionView: HTMLElement
  textarea: HTMLTextAreaElement
}

function openTerminal(): Harness {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const terminal = new Terminal()
  terminal.open(container)
  const textarea = terminal.textarea
  if (!textarea) {
    throw new Error('xterm helper textarea was not created')
  }
  const compositionView = container.querySelector('.composition-view')
  if (!(compositionView instanceof HTMLElement)) {
    throw new Error('xterm composition view was not created')
  }
  return { compositionView, textarea }
}

function dispatchCompositionEvent(
  textarea: HTMLTextAreaElement,
  type: 'compositionstart' | 'compositionupdate',
  data = ''
): void {
  const event = new CompositionEvent(type, { bubbles: true })
  // happy-dom ignores CompositionEventInit.data, but Chromium supplies it.
  Object.defineProperty(event, 'data', { value: data })
  textarea.dispatchEvent(event)
}

function dispatchKey(
  textarea: HTMLTextAreaElement,
  type: 'keydown' | 'keyup',
  keyCode: number,
  key: string,
  code: string
): void {
  const event = new KeyboardEvent(type, { key, code, isComposing: keyCode === 229, bubbles: true })
  Object.defineProperty(event, 'keyCode', { value: keyCode })
  textarea.dispatchEvent(event)
}

function setValue(textarea: HTMLTextAreaElement, value: string): void {
  textarea.value = value
  textarea.selectionStart = value.length
  textarea.selectionEnd = value.length
}

/** Advance the preedit by one macOS 2-Set jamo; every such keydown is keyCode 229. */
async function typeJamo(
  { textarea }: Harness,
  preedit: string,
  code: string,
  opening = false
): Promise<void> {
  dispatchKey(textarea, 'keydown', 229, 'Process', code)
  if (opening) {
    dispatchCompositionEvent(textarea, 'compositionstart')
  }
  setValue(textarea, preedit)
  dispatchCompositionEvent(textarea, 'compositionupdate', preedit)
  await nextEventLoop()
}

/** Compose 한, leaving the preedit live and displayed. */
async function composeHan(harness: Harness): Promise<void> {
  await typeJamo(harness, 'ㅎ', 'KeyG', true)
  await typeJamo(harness, '하', 'KeyK')
  await typeJamo(harness, '한', 'KeyS')
}

/** Press and release a modifier while the composition is live, then keep composing. */
async function pressModifierMidComposition(
  harness: Harness,
  keyCode: number,
  key: string,
  code: string
): Promise<void> {
  dispatchKey(harness.textarea, 'keydown', keyCode, key, code)
  await nextEventLoop()
  dispatchKey(harness.textarea, 'keyup', keyCode, key, code)
  await nextEventLoop()
}

const EXEMPT_MODIFIERS: [string, number, string, string][] = [
  ['Shift', 16, 'Shift', 'ShiftLeft'],
  ['Ctrl', 17, 'Control', 'ControlLeft'],
  ['Alt', 18, 'Alt', 'AltLeft']
]

describe('xterm composition modifier exemption — macOS Cmd is missing from the safe set', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      measureText: () => ({ width: 10 })
    } as unknown as CanvasRenderingContext2D)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.replaceChildren()
  })

  it.each([
    ['left Cmd', 91, 'Meta', 'MetaLeft'],
    ['right Cmd', 93, 'Meta', 'MetaRight']
  ])(
    '%s tears the preedit overlay down and it never comes back',
    async (_label, keyCode, key, code) => {
      const harness = await openTerminal()
      await composeHan(harness)
      // Precondition: without it, "inactive" below would be vacuous.
      expect(harness.compositionView.classList.contains('active')).toBe(true)

      await pressModifierMidComposition(harness, keyCode, key, code)
      expect(harness.compositionView.classList.contains('active')).toBe(false)

      // The IME never ended the composition, so the user keeps typing the same word —
      // and every further jamo stays invisible, because only compositionstart re-arms
      // the overlay and the IME has no reason to send one.
      await typeJamo(harness, '한ㄱ', 'KeyR')
      expect(harness.compositionView.textContent).toContain('한ㄱ')
      expect(harness.compositionView.classList.contains('active')).toBe(false)
    }
  )

  it.each(EXEMPT_MODIFIERS)(
    'paired negative: %s is exempt, so the same gesture keeps the preedit displayed',
    async (_label, keyCode, key, code) => {
      const harness = await openTerminal()
      await composeHan(harness)
      expect(harness.compositionView.classList.contains('active')).toBe(true)

      await pressModifierMidComposition(harness, keyCode, key, code)
      expect(harness.compositionView.classList.contains('active')).toBe(true)

      await typeJamo(harness, '한ㄱ', 'KeyR')
      expect(harness.compositionView.textContent).toContain('한ㄱ')
      expect(harness.compositionView.classList.contains('active')).toBe(true)
    }
  )
})
