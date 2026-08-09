// @vitest-environment happy-dom
// Replays a recorded Windows/WSL 2-Set Korean capture and asserts the preedit stayed visible.
//
// The capture contains the ordering that hides it: three compositionupdates that resume a
// composition with no second compositionstart. xterm adds `.active` only in compositionstart and
// removes it in compositionend, so those three updates were written into a hidden overlay and the
// user composed blind. Committed syllables still landed, which is why byte-level assertions never
// saw it.
//
// This is the recorded counterpart to terminal-ime-xterm-resumed-preedit-visibility.test.ts: that
// one pins the shape synthetically, this one proves it against events a real IME actually emitted.
import { Terminal } from '@xterm/xterm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import trace from './__fixtures__/windows-wsl-hangul-resumed-preedit-trace.json'

type RecordedEvent = {
  type: string
  inputType?: string
  data?: string
  key?: string
  code?: string
  keyCode?: number
  isComposing?: boolean
  value?: string
  selectionStart?: number
  selectionEnd?: number
}

function nextEventLoop(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0))
}

function buildEvent(recorded: RecordedEvent): Event {
  if (recorded.type === 'keydown' || recorded.type === 'keyup') {
    const keyboard = new KeyboardEvent(recorded.type, {
      key: recorded.key,
      code: recorded.code,
      isComposing: recorded.isComposing,
      bubbles: true,
      cancelable: true
    })
    Object.defineProperty(keyboard, 'keyCode', { value: recorded.keyCode })
    return keyboard
  }
  if (recorded.type === 'input' || recorded.type === 'beforeinput') {
    const input = new InputEvent(recorded.type, {
      isComposing: recorded.isComposing,
      bubbles: true
    })
    // happy-dom drops these from InputEventInit; Chromium supplies them.
    Object.defineProperty(input, 'inputType', { value: recorded.inputType ?? '' })
    Object.defineProperty(input, 'data', { value: recorded.data ?? null })
    Object.defineProperty(input, 'composed', { value: true })
    return input
  }
  const composition = new CompositionEvent(recorded.type, { bubbles: true })
  Object.defineProperty(composition, 'data', { value: recorded.data ?? '' })
  return composition
}

describe('Windows/WSL Korean — preedit the IME resumes without a compositionstart', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      measureText: () => ({ width: 10 })
    } as unknown as CanvasRenderingContext2D)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.replaceChildren()
  })

  it('keeps every resumed preedit visible', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const terminal = new Terminal()
    terminal.open(container)
    const textarea = terminal.textarea
    if (!textarea) {
      throw new Error('xterm helper textarea was not created')
    }

    const events = trace.dom as RecordedEvent[]
    let compositionOpen = false
    const resumed: { data: string; shown: boolean }[] = []

    for (const recorded of events) {
      if (recorded.type === 'keydown' || recorded.type === 'keyup') {
        await nextEventLoop()
      }
      if (recorded.value !== undefined) {
        textarea.value = recorded.value
      }
      if (recorded.selectionStart !== undefined && recorded.selectionEnd !== undefined) {
        textarea.setSelectionRange(recorded.selectionStart, recorded.selectionEnd)
      }
      textarea.dispatchEvent(buildEvent(recorded))

      if (recorded.type === 'compositionstart') {
        compositionOpen = true
      } else if (recorded.type === 'compositionend') {
        compositionOpen = false
      } else if (recorded.type === 'compositionupdate' && recorded.data && !compositionOpen) {
        const view = terminal.element?.querySelector('.composition-view')
        resumed.push({
          data: recorded.data,
          shown: view?.classList.contains('active') === true
        })
      }
    }
    terminal.dispose()

    // The capture holds exactly three; if it ever holds none the fixture has been replaced and this
    // assertion would pass while covering nothing.
    expect(resumed).toHaveLength(3)
    expect(resumed.filter((sample) => !sample.shown)).toEqual([])
  })
})
