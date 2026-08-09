// @vitest-environment happy-dom
// An input source that substitutes text for a printable key commits it through a
// bare `insertText` with no composition session. Drives a real Terminal wired the
// way the pane lifecycle wires it, so it covers the whole keydown -> input path.
import { Terminal } from '@xterm/xterm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installTerminalImeNativeTextForwarder } from './terminal-ime-native-text-forwarder'
import { shouldBypassXtermKeyboardEvent } from './xterm-bypass-policy'

type SubstitutionCase = {
  name: string
  code: string
  keyCode: number
  shiftKey?: boolean
  layoutText: string
  imeText: string
}

function open(kittyKeyboardFlags = 0) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const terminal = new Terminal()
  terminal.open(container)
  const textarea = terminal.textarea!
  const forwarder = installTerminalImeNativeTextForwarder({
    terminalElement: terminal.element,
    isComposing: () => false,
    sendInput: (data) => terminal.input(data)
  })
  terminal.attachCustomKeyEventHandler((event) => {
    if (forwarder.claimKeyEvent(event)) {
      return false
    }
    return !shouldBypassXtermKeyboardEvent(event, {
      isMac: true,
      hasSelection: false,
      kittyKeyboardFlags
    })
  })
  const emitted: string[] = []
  terminal.onData((d) => emitted.push(d))
  return { emitted, terminal, textarea, forwarder }
}

function key(
  textarea: HTMLTextAreaElement,
  type: string,
  init: { key: string; code: string; keyCode: number; shiftKey: boolean }
): KeyboardEvent {
  const ev = new KeyboardEvent(type, {
    key: init.key,
    code: init.code,
    shiftKey: init.shiftKey,
    bubbles: true,
    cancelable: true
  })
  Object.defineProperty(ev, 'keyCode', { value: init.keyCode })
  Object.defineProperty(ev, 'charCode', { value: type === 'keypress' ? init.keyCode : 0 })
  textarea.dispatchEvent(ev)
  return ev
}

function insertText(textarea: HTMLTextAreaElement, type: string, data: string): void {
  const ev = new InputEvent(type, { bubbles: true })
  Object.defineProperty(ev, 'inputType', { value: 'insertText' })
  Object.defineProperty(ev, 'data', { value: data })
  Object.defineProperty(ev, 'composed', { value: true })
  textarea.dispatchEvent(ev)
}

function press(textarea: HTMLTextAreaElement, c: SubstitutionCase): void {
  const shiftKey = c.shiftKey === true
  const kd = key(textarea, 'keydown', {
    key: c.layoutText,
    code: c.code,
    keyCode: c.keyCode,
    shiftKey
  })
  if (!kd.defaultPrevented) {
    if (c.imeText.length === 1) {
      key(textarea, 'keypress', {
        key: c.imeText,
        code: c.code,
        keyCode: c.imeText.charCodeAt(0),
        shiftKey
      })
    }
    textarea.value = c.imeText
    textarea.setSelectionRange(c.imeText.length, c.imeText.length)
    insertText(textarea, 'beforeinput', c.imeText)
    insertText(textarea, 'input', c.imeText)
  }
  key(textarea, 'keyup', { key: c.layoutText, code: c.code, keyCode: c.keyCode, shiftKey })
}

function type(cases: SubstitutionCase[], kitty = 0): string {
  const { emitted, terminal, textarea, forwarder } = open(kitty)
  for (const c of cases) {
    press(textarea, c)
  }
  forwarder.dispose()
  terminal.dispose()
  return emitted.join('')
}

const COMMA: SubstitutionCase = {
  name: 'comma',
  code: 'Comma',
  keyCode: 188,
  layoutText: ',',
  imeText: '，'
}
const PERIOD: SubstitutionCase = {
  name: 'period',
  code: 'Period',
  keyCode: 190,
  layoutText: '.',
  imeText: '。'
}
const QUESTION: SubstitutionCase = {
  name: 'question',
  code: 'Slash',
  keyCode: 191,
  shiftKey: true,
  layoutText: '?',
  imeText: '？'
}
const BACKSLASH: SubstitutionCase = {
  name: 'ideographic comma',
  code: 'Backslash',
  keyCode: 220,
  layoutText: '\\',
  imeText: '、'
}
const EM_DASH: SubstitutionCase = {
  name: 'em dash pair',
  code: 'Minus',
  keyCode: 189,
  shiftKey: true,
  layoutText: '_',
  imeText: '——'
}
const FULLWIDTH_ONE: SubstitutionCase = {
  name: 'full-width one',
  code: 'Digit1',
  keyCode: 49,
  layoutText: '1',
  imeText: '１'
}
const TELEX_A: SubstitutionCase = {
  name: 'telex a-acute',
  code: 'KeyS',
  keyCode: 83,
  layoutText: 's',
  imeText: 'á'
}

describe('input-source text substitution reaches the terminal', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      measureText: () => ({ width: 10 })
    } as unknown as CanvasRenderingContext2D)
  })
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.replaceChildren()
  })

  it('sends the substituted sentence tail, not the raw layout characters', () => {
    expect(type([COMMA, PERIOD, PERIOD])).toBe('，。。')
  })
  it('sends a shifted substitution', () => {
    expect(type([QUESTION])).toBe('？')
  })
  it('sends the backslash-position substitution (#10896)', () => {
    expect(type([BACKSLASH])).toBe('、')
  })
  it('sends a multi-code-unit substitution from one press', () => {
    expect(type([EM_DASH])).toBe('——')
  })
  it('sends a full-width digit substitution', () => {
    expect(type([FULLWIDTH_ONE])).toBe('１')
  })
  it('sends a letter substitution', () => {
    expect(type([TELEX_A])).toBe('á')
  })
  it('sends the substitution with kitty disambiguate reporting negotiated', () => {
    expect(type([COMMA], 1)).toBe('，')
  })

  // Pins a deliberate hole rather than a desired behaviour. Flag 8 asks for every printable key as
  // an escape code, and this path sends the committed text raw instead — a mature native terminal
  // makes the same trade, preferring correct characters to protocol fidelity. Recorded here so the
  // choice is visible: if this ever needs closing, gate on flag 8 alone, never on "kitty active",
  // which would disable the substitution for every pane that negotiates anything.
  it('sends the substitution raw even when kitty asks for all keys as escape codes', () => {
    expect(type([COMMA], 8)).toBe('，')
  })
})
