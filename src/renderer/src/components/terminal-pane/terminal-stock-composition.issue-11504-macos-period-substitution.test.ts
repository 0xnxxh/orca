// @vitest-environment happy-dom
import { Terminal } from '@xterm/xterm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Source: GitHub #11504, reporter `pythonstrup`, comment IC_kwDORpCz1s8AAAABMZuYXQ
// ("Correction to my previous comment"), macOS + Apple 2-Set Korean + Orca 1.4.161.
// Transcribed at .tmp/ime-handoff/swarm-scratch/lane7-11504-macos-period/MANIFEST.md
// SHA-256 e2ed51b1add37c366475413590043b948bfb5738ec849ce6bdeac1e57c9bdb9e, and independently at
// .tmp/ime-handoff/swarm-scratch/lane-9738-composer/COMMENT-SWEEP.md
// SHA-256 086a3bc5d36db0a58a9c23970a762423d73e5e90e7c07eeb1a3081a014c51920. Both agree line for line.
//
//   keydown           key:" " code:Space keyCode:229 isComposing:true  val:"아"
//   compositionupdate data:"아 "                                        val:"아"
//   input             data:"아 " inputType:insertCompositionText        val:"아 "
//   compositionend    data:"아 "                                        val:"아 "
//   keyup             key:" " code:Space keyCode:32  isComposing:false  val:"아 "
//   input             data:". " inputType:insertText                    val:"아. "   <- +149ms
//
// The reporter's own words on the trigger: "There is no second press at all. One space is enough" —
// the composition commit supplies the first slot of macOS `NSAutomaticPeriodSubstitutionEnabled`,
// so with a Hangul source every word-separating space is a candidate.
//
// NOT recorded anywhere in the corpus: `composed` and `timeStamp`. `composed` is the field the
// stock guard branches on, so it is set to `true` here — the value the UI Events spec requires of
// a browser-dispatched `input` event. It is the harder case for the guard: the +149 ms arm below
// passes with `composed` either way, and only the keydown-in-flight arm depends on it.
//
// These tests pin CURRENT, DEFECTIVE behaviour. #11504 is unfixed at HEAD (PR #11506 is open and
// unmerged) and the first test asserts the unwanted period reaches the PTY. A fix must update it.

const HANGUL = '아'
const COMMITTED = '아 '
const SUBSTITUTION = '. '
const SPACE_KEYCODE = 32
const IME_KEYCODE = 229

function openTerminal(): {
  emitted: string[]
  terminal: Terminal
  textarea: HTMLTextAreaElement
} {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const terminal = new Terminal()
  terminal.open(container)
  if (!terminal.textarea) {
    throw new Error('xterm helper textarea was not created')
  }
  const emitted: string[] = []
  terminal.onData((data) => emitted.push(data))
  return { emitted, terminal, textarea: terminal.textarea }
}

function composition(
  textarea: HTMLTextAreaElement,
  type: 'compositionstart' | 'compositionupdate' | 'compositionend',
  data = ''
): void {
  const event = new CompositionEvent(type, { bubbles: true })
  Object.defineProperty(event, 'data', { value: data })
  textarea.dispatchEvent(event)
}

function keydown(textarea: HTMLTextAreaElement, keyCode: number, isComposing = false): void {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    code: 'Space',
    isComposing,
    key: ' '
  })
  Object.defineProperty(event, 'keyCode', { value: keyCode })
  textarea.dispatchEvent(event)
}

function keyup(textarea: HTMLTextAreaElement): void {
  const event = new KeyboardEvent('keyup', { bubbles: true, code: 'Space', key: ' ' })
  Object.defineProperty(event, 'keyCode', { value: SPACE_KEYCODE })
  textarea.dispatchEvent(event)
}

// The OS substitution: an `insertText` carrying no keydown, keypress or charCode of its own. The
// reporter's `beforeinput` capture records `key/code/keyCode: undefined` and a listener-only stack.
function substitutionInput(textarea: HTMLTextAreaElement, value: string): void {
  textarea.value = value
  textarea.setSelectionRange(value.length, value.length)
  const event = new InputEvent('input', {
    bubbles: true,
    composed: true,
    data: SUBSTITUTION,
    inputType: 'insertText',
    isComposing: false
  })
  // The guard reads `composed`; a harness that dropped it would make the suppression arms below
  // pass vacuously, so fail here instead of there.
  expect(event.composed).toBe(true)
  textarea.dispatchEvent(event)
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0))
}

// Replays every line of the recorded trace above except its last, leaving the terminal in the state
// the reporter's `+149ms` substitution arrives into.
function replayRecordedCommit(textarea: HTMLTextAreaElement): void {
  composition(textarea, 'compositionstart')
  composition(textarea, 'compositionupdate', HANGUL)
  textarea.value = HANGUL
  textarea.setSelectionRange(1, 1)

  keydown(textarea, IME_KEYCODE, true)
  composition(textarea, 'compositionupdate', COMMITTED)
  textarea.value = COMMITTED
  textarea.setSelectionRange(2, 2)
  textarea.dispatchEvent(
    new InputEvent('input', {
      bubbles: true,
      composed: true,
      data: COMMITTED,
      inputType: 'insertCompositionText',
      isComposing: true
    })
  )
  composition(textarea, 'compositionend', COMMITTED)
  keyup(textarea)
}

describe('#11504 macOS automatic period substitution after a Hangul space commit', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      measureText: () => ({ width: 10 })
    } as unknown as CanvasRenderingContext2D)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.replaceChildren()
  })

  it('sends the reporter delayed period substitution to the PTY as extra input', async () => {
    const { emitted, terminal, textarea } = openTerminal()
    replayRecordedCommit(textarea)
    // Two drains: the commit send and the window that closes it. The reporter's +149 ms is far past
    // both, which is precisely why the substitution reaches the stock branch.
    await nextTask()
    await nextTask()
    expect(emitted).toEqual([COMMITTED])

    substitutionInput(textarea, '아. ')
    await nextTask()

    expect(emitted).toEqual([COMMITTED, SUBSTITUTION])
    // The textarea replaced the space; the terminal appended. That divergence is the reported bug —
    // a period the user never typed, sitting in the shell's input.
    expect(textarea.value).toBe('아. ')
    expect(emitted.join('')).toBe('아 . ')
    terminal.dispose()
  })

  it('suppresses the identical payload while a keydown is still in flight', async () => {
    const { emitted, terminal, textarea } = openTerminal()
    replayRecordedCommit(textarea)
    await nextTask()
    await nextTask()

    // Space is keyCode 32, below xterm's `>= 48` printable floor, so the keydown itself emits
    // nothing — it only raises `_keyDownSeen`, which is the half of the guard under test.
    keydown(textarea, SPACE_KEYCODE)
    substitutionInput(textarea, '아 . ')
    await nextTask()

    expect(emitted).toEqual([COMMITTED])
    keyup(textarea)

    // Precondition for the absence above: the same payload does get through once keyup lands.
    substitutionInput(textarea, '아 . ')
    await nextTask()

    expect(emitted).toEqual([COMMITTED, SUBSTITUTION])
    terminal.dispose()
  })

  it('absorbs a substitution that lands before the commit send window drains', async () => {
    const { emitted, terminal, textarea } = openTerminal()
    replayRecordedCommit(textarea)
    await nextTask()
    expect(emitted).toEqual([COMMITTED])

    // Same payload, same guards, only earlier: Orca's `handleCompositionInput` intercept still owns
    // the path here and swallows it. The delay in the report is a trigger condition, not a detail.
    substitutionInput(textarea, '아. ')
    await nextTask()
    await nextTask()

    expect(emitted).toEqual([COMMITTED])
    terminal.dispose()
  })

  it('does not double a period the user actually typed', async () => {
    const { emitted, terminal, textarea } = openTerminal()
    const period = new KeyboardEvent('keydown', { bubbles: true, code: 'Period', key: '.' })
    Object.defineProperty(period, 'keyCode', { value: 190 })
    textarea.dispatchEvent(period)
    textarea.value = '.'
    textarea.setSelectionRange(1, 1)
    textarea.dispatchEvent(
      new InputEvent('input', { bubbles: true, composed: true, data: '.', inputType: 'insertText' })
    )
    await nextTask()

    expect(emitted).toEqual(['.'])
    terminal.dispose()
  })
})
