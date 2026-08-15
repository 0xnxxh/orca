// @vitest-environment happy-dom
// Replays candidate-selection captures taken against a live ibus-daemon on Linux/X11
// (see the fixture's `recordedFrom`) through a real xterm Terminal wired with the pane's
// Linux IME key policy, and asserts the PTY bytes.
//
// The gesture is #12099: pick a candidate with a number key. A one-character pick is asserted
// separately from a multi-character one because only the one-character pick can be committed
// with no preedit of its own, which is the shape xterm drops.
import { Terminal } from '@xterm/xterm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import trace from './__fixtures__/ibus-chinese-candidate-digit-terminal-trace.json'
import { installTerminalImeCandidateCommitWindow } from './terminal-ime-candidate-commit-window'
import {
  armTerminalImePendingCandidateKeyRelease,
  clearTerminalImePendingCandidateKeyRelease,
  createTerminalImePendingCandidateKeyReleases,
  shouldApplyTerminalImePendingCandidateKeyRelease
} from './terminal-ime-candidate-key-release-guard'
import {
  hasPendingTerminalImeComposition,
  installTerminalImeCompositionRoute
} from './terminal-ime-composition-route'
import { installTerminalImeCompositionTracker } from './terminal-ime-composition-tracker'
import { installTerminalImeKeydownRaceCommit } from './terminal-ime-keydown-race-commit'
import { installTerminalImeLinuxCandidateState } from './terminal-ime-linux-candidate-state'
import {
  shouldPreventDefaultTerminalImeCandidateKey,
  shouldSuppressTerminalImeKeyboardEvent,
  type XtermBypassEvent
} from './xterm-bypass-policy'

type RecordedEvent = {
  type: string
  key?: string
  code?: string
  keyCode?: number
  isComposing?: boolean
  inputType?: string
  data?: string
  value?: string
  selectionStart?: number
  selectionEnd?: number
}

type Pane = {
  emitted: string[]
  /** Key events the policy handed to xterm rather than claiming for the IME. */
  reachedXterm: XtermBypassEvent[]
  terminal: Terminal
  textarea: HTMLTextAreaElement
  dispose: () => void
}

function capture(name: string): { dom: RecordedEvent[]; committed: string } {
  const found = trace.captures.find((entry) => entry.name === name)
  if (!found) {
    throw new Error(`missing recorded capture: ${name}`)
  }
  return { dom: found.dom as RecordedEvent[], committed: found.committed }
}

/** Wires a real Terminal with the same Linux IME key policy `use-terminal-pane-lifecycle` installs. */
function openPane(): Pane {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const terminal = new Terminal()
  terminal.open(container)
  const textarea = terminal.textarea
  const element = terminal.element
  if (!textarea || !element) {
    throw new Error('xterm helper elements were not created')
  }
  const emitted: string[] = []
  terminal.onData((data) => emitted.push(data))
  const reachedXterm: XtermBypassEvent[] = []

  const transport = { getPtyId: () => 'trace-pty' }
  const compositionRoute = installTerminalImeCompositionRoute({
    terminalElement: element,
    terminal,
    capturedTransport: transport as never,
    getCurrentTransport: () => transport as never
  })
  const compositionTracker = installTerminalImeCompositionTracker(element)
  const linuxCandidateState = installTerminalImeLinuxCandidateState(element)
  const candidateCommitWindow = installTerminalImeCandidateCommitWindow({
    terminalElement: element
  })
  const keydownRaceCommit = installTerminalImeKeydownRaceCommit({
    terminalElement: element,
    sendInput: (data) => terminal.input(data),
    hasPendingComposition: () =>
      compositionTracker.isActive() || hasPendingTerminalImeComposition(element)
  })
  const pendingReleases = createTerminalImePendingCandidateKeyReleases()

  terminal.attachCustomKeyEventHandler((e) => {
    const classification = linuxCandidateState.classifyKeyboardEvent(e)
    const observe = (): void => {
      linuxCandidateState.observeKeyboardEvent(e, classification)
      candidateCommitWindow.observeKeyboardEvent(e)
      keydownRaceCommit.observeKeyboardEvent(e)
    }
    const now = Date.now()
    const pendingRelease =
      shouldApplyTerminalImePendingCandidateKeyRelease(e, pendingReleases, now) ||
      candidateCommitWindow.shouldAbsorbKeyEvent(e, now)
    const options = {
      compositionActive: compositionTracker.isActive(),
      candidateKeyGuardActive: compositionTracker.isCandidateKeyGuardActive() || pendingRelease,
      pendingCandidateKeyReleaseActive: pendingRelease,
      linuxOrphanCandidateDigitGuardActive: classification.candidateDigitGuardActive,
      isMac: false,
      isLinux: true
    }
    if (shouldSuppressTerminalImeKeyboardEvent(e, options)) {
      clearTerminalImePendingCandidateKeyRelease(pendingReleases, e)
      if (shouldPreventDefaultTerminalImeCandidateKey(e, options)) {
        armTerminalImePendingCandidateKeyRelease(pendingReleases, e, now)
      }
      observe()
      return false
    }
    clearTerminalImePendingCandidateKeyRelease(pendingReleases, e)
    observe()
    reachedXterm.push(e)
    return true
  })

  return {
    emitted,
    reachedXterm,
    terminal,
    textarea,
    dispose: () => {
      keydownRaceCommit.dispose()
      candidateCommitWindow.dispose()
      linuxCandidateState.dispose()
      compositionTracker.dispose()
      compositionRoute.dispose()
      terminal.dispose()
    }
  }
}

function buildEvent(recorded: RecordedEvent): Event {
  if (recorded.type === 'keydown' || recorded.type === 'keyup' || recorded.type === 'keypress') {
    const keyboard = new KeyboardEvent(recorded.type, {
      bubbles: true,
      cancelable: true,
      code: recorded.code,
      isComposing: recorded.isComposing,
      key: recorded.key
    })
    Object.defineProperty(keyboard, 'keyCode', { value: recorded.keyCode })
    return keyboard
  }
  if (recorded.type === 'input' || recorded.type === 'beforeinput') {
    const input = new InputEvent(recorded.type, {
      bubbles: true,
      isComposing: recorded.isComposing
    })
    // happy-dom drops these from InputEventInit; Chromium supplies all of them.
    Object.defineProperty(input, 'inputType', { value: recorded.inputType ?? '' })
    Object.defineProperty(input, 'data', { value: recorded.data ?? null })
    Object.defineProperty(input, 'composed', { value: true })
    return input
  }
  const composition = new CompositionEvent(recorded.type, { bubbles: true })
  Object.defineProperty(composition, 'data', { value: recorded.data ?? '' })
  return composition
}

/** Each capture snapshots the textarea as the handler saw it, so restore that before dispatching. */
function replay(pane: Pane, recorded: RecordedEvent): void {
  if (recorded.value !== undefined) {
    pane.textarea.value = recorded.value
  }
  if (recorded.selectionStart !== undefined && recorded.selectionEnd !== undefined) {
    pane.textarea.setSelectionRange(recorded.selectionStart, recorded.selectionEnd)
  }
  pane.textarea.dispatchEvent(buildEvent(recorded))
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0))
}

async function replayCapture(pane: Pane, name: string): Promise<string> {
  const { dom } = capture(name)
  for (const recorded of dom) {
    // Keys were driven ~80 ms apart, so each physical key event owned its own task.
    if (recorded.type === 'keydown' || recorded.type === 'keyup') {
      await nextTask()
    }
    replay(pane, recorded)
  }
  await nextTask()
  return pane.emitted.join('')
}

describe('Linux IBus candidate commit', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      measureText: () => ({ width: 10 })
    } as unknown as CanvasRenderingContext2D)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.replaceChildren()
  })

  it('delivers a one-character candidate committed as insertText on the selector keydown', async () => {
    const pane = openPane()
    // xterm ignores an insertText commit while a keydown is in flight
    // (CoreBrowserTerminal._inputEvent: `!ev.composed || !this._keyDownSeen`), which is
    // exactly a one-character pick committed with no preedit of its own — #12099. A
    // multi-character pick needs a preedit, so it commits through compositionend instead.
    await nextTask()
    replay(pane, { type: 'keydown', key: '1', code: 'Digit1', keyCode: 49 })
    replay(pane, { type: 'input', inputType: 'insertText', data: '你', value: '你' })
    await nextTask()
    replay(pane, { type: 'keyup', key: '1', code: 'Digit1', keyCode: 49 })
    await nextTask()

    // Not an exact match: the selector byte xterm already sent before the commit arrived is a
    // separate, still-open leak. This pins the wipe — the committed character now reaches the pty.
    expect(pane.emitted.join('')).toContain('你')
    pane.dispose()
  })

  it('sends a commit that follows a bare 229 keydown exactly once', async () => {
    const pane = openPane()
    // xterm answers a standalone 229 keydown with its own textarea-diff commit, so the
    // forwarder must stay out of that press or the character arrives twice.
    await nextTask()
    replay(pane, { type: 'keydown', key: 'Process', code: 'Digit1', keyCode: 229 })
    replay(pane, { type: 'input', inputType: 'insertText', data: '\u4f60', value: '\u4f60' })
    await nextTask()
    replay(pane, { type: 'keyup', key: '1', code: 'Digit1', keyCode: 49 })
    await nextTask()

    expect(pane.emitted.join('')).toBe('\u4f60')
    pane.dispose()
  })

  it('sends a mouse-picked commit exactly once', async () => {
    const pane = openPane()
    // No keydown in flight: xterm owns this one, and the forwarder must stay out.
    replay(pane, { type: 'input', inputType: 'insertText', data: '你', value: '你' })
    await nextTask()

    expect(pane.emitted.join('')).toBe('你')
    pane.dispose()
  })

  it('keeps the recorded one-character candidate pick out of a trailing bare digit', async () => {
    const pane = openPane()
    const emitted = await replayCapture(pane, 'ibus-table-cangjie5-single-char-digit')

    expect(emitted).toBe(capture('ibus-table-cangjie5-single-char-digit').committed)
    expect(
      pane.reachedXterm.filter((event) => event.key === '1'),
      'the selector release must not reach xterm after the composition it committed'
    ).toEqual([])
    pane.dispose()
  })

  it('keeps a recorded multi-character candidate pick working', async () => {
    const pane = openPane()
    const emitted = await replayCapture(pane, 'ibus-two-char-digit')

    expect(emitted).toBe(capture('ibus-two-char-digit').committed)
    expect(pane.reachedXterm.filter((event) => event.key === '2')).toEqual([])
    pane.dispose()
  })

  it('keeps the recorded hanja number pick working', async () => {
    const pane = openPane()
    const emitted = await replayCapture(pane, 'ibus-hangul-hanja-single-char-digit')

    expect(emitted).toBe(capture('ibus-hangul-hanja-single-char-digit').committed)
    pane.dispose()
  })

  it('still suppresses a bare candidate digit after an orphaned letter release', async () => {
    const pane = openPane()
    await nextTask()
    replay(pane, { type: 'keyup', key: 'a', code: 'KeyA', keyCode: 65 })
    await nextTask()
    replay(pane, { type: 'keydown', key: '1', code: 'Digit1', keyCode: 49 })
    await nextTask()

    expect(pane.emitted.join('')).toBe('')
    pane.dispose()
  })

  it('leaves ordinary typing alone', async () => {
    const pane = openPane()
    for (const [key, code, keyCode] of [
      ['a', 'KeyA', 65],
      ['1', 'Digit1', 49],
      ['b', 'KeyB', 66],
      ['2', 'Digit2', 50]
    ] as const) {
      await nextTask()
      replay(pane, { type: 'keydown', key, code, keyCode })
      replay(pane, { type: 'keyup', key, code, keyCode })
    }
    await nextTask()

    expect(pane.emitted.join('')).toBe('a1b2')
    pane.dispose()
  })
})
