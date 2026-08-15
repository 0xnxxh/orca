import type { IDisposable } from '@xterm/xterm'

type TerminalImeRaceKeyEvent = {
  type: string
  key?: string
  keyCode?: number
  isComposing?: boolean
}

export type TerminalImeKeydownRaceCommit = IDisposable & {
  /** Feeds a terminal key event in; call for every event the pane handles. */
  observeKeyboardEvent: (event: TerminalImeRaceKeyEvent) => void
}

/** Returns whether the browser marked this keystroke as IME-owned. */
function isImeOwnedKeydown(event: TerminalImeRaceKeyEvent): boolean {
  return event.isComposing === true || event.keyCode === 229 || event.key === 'Process'
}

/**
 * Forwards an IME commit that xterm drops because a keydown is still in flight.
 *
 * xterm only accepts an `insertText` input event when `!ev.composed ||
 * !this._keyDownSeen` (CoreBrowserTerminal._inputEvent), so a commit delivered
 * inside the candidate key's own keydown is discarded — the reported single
 * character vanishes while a mouse pick, which has no keydown in flight,
 * survives. The condition here is the exact complement of xterm's own emitting
 * paths, so the same commit can never be sent twice.
 */
export function installTerminalImeKeydownRaceCommit(args: {
  terminalElement: HTMLElement | null | undefined
  sendInput: (data: string) => void
  hasPendingComposition: () => boolean
}): TerminalImeKeydownRaceCommit {
  let ordinaryKeydownInFlight = false

  // Mirrors xterm's own _keyDownSeen, which it sets before the custom key
  // handler runs and clears at the top of keyup. IME-marked presses are
  // excluded: xterm answers a bare 229 keydown with its textarea-diff commit,
  // so forwarding those would send the same text twice.
  const observeKeyboardEvent = (event: TerminalImeRaceKeyEvent): void => {
    if (event.type === 'keydown') {
      ordinaryKeydownInFlight = !isImeOwnedKeydown(event)
      return
    }
    if (event.type === 'keyup') {
      ordinaryKeydownInFlight = false
    }
  }

  const forwardDroppedCommit = (event: Event): void => {
    if (!(event instanceof InputEvent) || event.inputType !== 'insertText' || !event.data) {
      return
    }
    if (!event.composed || !ordinaryKeydownInFlight || event.isComposing === true) {
      return
    }
    // A live or unsettled composition transaction owns its own commit.
    if (args.hasPendingComposition()) {
      return
    }
    args.sendInput(event.data)
  }

  const clearKeydown = (): void => {
    ordinaryKeydownInFlight = false
  }

  const terminalElement = args.terminalElement
  if (!terminalElement) {
    return { observeKeyboardEvent, dispose: () => undefined }
  }
  terminalElement.addEventListener('input', forwardDroppedCommit, true)
  terminalElement.addEventListener('blur', clearKeydown, true)
  return {
    observeKeyboardEvent,
    dispose: () => {
      terminalElement.removeEventListener('input', forwardDroppedCommit, true)
      terminalElement.removeEventListener('blur', clearKeydown, true)
    }
  }
}
