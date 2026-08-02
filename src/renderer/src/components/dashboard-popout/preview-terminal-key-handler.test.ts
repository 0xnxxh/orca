// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Terminal } from '@xterm/xterm'
import type { DashboardCardTerminalInput } from '../../../../shared/dashboard-snapshot'
import { installPreviewTerminalKeyHandler } from './preview-terminal-key-handler'

const LOCAL_MAC: DashboardCardTerminalInput = {
  hostPlatform: 'darwin',
  localWindowsConpty: false,
  windowsShiftEnterEncoding: 'alt-enter',
  kittyKeyboardAdvertised: true
}

function installHandler(): {
  handle: (event: KeyboardEvent) => boolean
  sendInput: ReturnType<typeof vi.fn>
  dispose: () => void
} {
  let handle: (event: KeyboardEvent) => boolean = () => true
  const sendInput = vi.fn()
  const terminal = {
    attachCustomKeyEventHandler: (handler: (event: KeyboardEvent) => boolean) => {
      handle = handler
    },
    element: document.createElement('div'),
    getSelection: () => '',
    scrollToTop: vi.fn(),
    scrollToBottom: vi.fn()
  } as unknown as Terminal
  const dispose = installPreviewTerminalKeyHandler({
    terminal,
    claimImeKeyEvent: () => false,
    pasteClipboardText: vi.fn(),
    sendInput,
    getShortcutContext: () => ({
      clientPlatform: 'darwin',
      macOptionAsAlt: 'false',
      keybindings: undefined,
      terminalInput: LOCAL_MAC,
      kittyKeyboardActive: () => false,
      terminalShortcutPolicy: 'orca-first'
    })
  })
  return { handle: (event) => handle(event), sendInput, dispose }
}

function keydown(init: KeyboardEventInit & { keyCode?: number }): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  if (init.keyCode !== undefined) {
    Object.defineProperty(event, 'keyCode', { value: init.keyCode })
  }
  return event
}

function keyup(init: KeyboardEventInit & { keyCode?: number }): KeyboardEvent {
  const event = new KeyboardEvent('keyup', { bubbles: true, cancelable: true, ...init })
  if (init.keyCode !== undefined) {
    Object.defineProperty(event, 'keyCode', { value: init.keyCode })
  }
  return event
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('preview terminal key handler yields to a composition', () => {
  // This preview writes to a live pty, so a chord that escapes here reaches the agent's
  // shell exactly as it would from a pane.
  it('does not send Ctrl+Backspace to the pty while composing', () => {
    const handler = installHandler()

    const handled = handler.handle(
      keydown({ key: 'Backspace', code: 'Backspace', ctrlKey: true, keyCode: 229 })
    )

    expect(handler.sendInput).not.toHaveBeenCalled()
    expect(handled).toBe(true)
    handler.dispose()
  })

  // No deferred-newline path exists here, so the newline cannot be replayed after the
  // commit — the only correct move is to let the keystroke close the composition.
  it('does not send Shift+Enter to the pty while composing', () => {
    const handler = installHandler()

    handler.handle(
      keydown({ key: 'Enter', code: 'Enter', shiftKey: true, keyCode: 13, isComposing: true })
    )

    expect(handler.sendInput).not.toHaveBeenCalled()
    handler.dispose()
  })

  it('still sends Ctrl+Backspace when nothing is composing', () => {
    const handler = installHandler()

    handler.handle(keydown({ key: 'Backspace', code: 'Backspace', ctrlKey: true, keyCode: 8 }))

    expect(handler.sendInput).toHaveBeenCalledWith('\x17')
    handler.dispose()
  })

  it('still sends Shift+Enter when nothing is composing', () => {
    const handler = installHandler()

    handler.handle(keydown({ key: 'Enter', code: 'Enter', shiftKey: true, keyCode: 13 }))

    expect(handler.sendInput).toHaveBeenCalledWith('\x1b\r')
    handler.dispose()
  })

  // Releases matter on their own once Kitty REPORT_EVENT_TYPES is negotiated: xterm encodes
  // an accepted keyup into a release sequence, so withholding only the keydown still leaks
  // half the chord into the preedit.
  it('withholds an IME-owned keyup from xterm', () => {
    const handler = installHandler()

    expect(handler.handle(keyup({ key: 'ArrowLeft', code: 'ArrowLeft', isComposing: true }))).toBe(
      false
    )
    handler.dispose()
  })

  it('hands an ordinary keyup to xterm', () => {
    const handler = installHandler()

    expect(handler.handle(keyup({ key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 }))).toBe(true)
    handler.dispose()
  })

  // The release guard must not widen to keypress: a composing keypress can carry the
  // committed glyph, and withholding it from xterm drops the text off the live PTY. This is
  // the same shape the pane policy deliberately lets through (xterm-bypass-policy.ts).
  it('hands a composing keypress to xterm so the committed glyph survives', () => {
    const handler = installHandler()
    const event = new KeyboardEvent('keypress', {
      key: '中',
      bubbles: true,
      cancelable: true,
      isComposing: true
    })

    expect(handler.handle(event)).toBe(true)
    handler.dispose()
  })
})
