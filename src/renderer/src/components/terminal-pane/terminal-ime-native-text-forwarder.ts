import type { IDisposable } from '@xterm/xterm'

// Why: a plain printable keydown never produces terminal bytes. Bytes for
// printable characters come only from the `input` event, which on macOS *is*
// the text system's commit callback and carries whatever the input source
// actually produced (`，` for `,`, `、` for `\`, `——` for a single press).
// Xterm would otherwise send the raw layout character from the keydown and then
// preventDefault, destroying the committed text before Chromium can deliver it.
//
// The claim is structural, so it holds for input sources that do not exist yet:
// no input-source identity is read, and `key` is only ever measured for length.

type ClaimedKeyPress = {
  key: string
  code?: string
}

export type ImeNativeTextKeyEvent = {
  type: string
  key: string
  code?: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  isComposing?: boolean
}

export const XTERM_COMPOSITION_TRANSACTION_ACCEPTED_EVENT = 'xterm-composition-transaction-accepted'
export const XTERM_COMPOSITION_TRANSACTION_SETTLED_EVENT = 'xterm-composition-transaction-settled'

export type TerminalImeNativeTextForwarder = IDisposable & {
  /**
   * Returns true when this keyboard event belongs to a direct native text
   * commit and should bypass xterm (the caller should return `false` from
   * `attachCustomKeyEventHandler`). The committed text is forwarded later from
   * the `input` event via the `sendInput` dependency.
   */
  claimKeyEvent: (event: ImeNativeTextKeyEvent) => boolean
}

/**
 * A single printable keystroke with no control chord and no live composition.
 *
 * `key` is read for LENGTH ONLY, never identity — that is what makes the
 * predicate invariant under the `key` rewrite a CJK input source performs, and
 * why no punctuation table is needed. Length also excludes named keys (`Enter`,
 * `ArrowLeft`, `Dead`, `F3`) without enumerating them.
 */
function isNativeTextKeydown(event: ImeNativeTextKeyEvent, compositionActive: boolean): boolean {
  return (
    event.type === 'keydown' &&
    // Control chords are the byte-producing case and belong to xterm's encoder.
    // Shift stays eligible: shifted punctuation still commits substituted text.
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    event.key.length === 1 &&
    // Composing keystrokes already belong to xterm's composition helper.
    event.isComposing !== true &&
    !compositionActive
  )
}

function matchesClaimedPress(event: ImeNativeTextKeyEvent, claimedPress: ClaimedKeyPress): boolean {
  if (event.code && claimedPress.code) {
    return event.code === claimedPress.code
  }
  return event.key === claimedPress.key
}

export function installTerminalImeNativeTextForwarder(args: {
  terminalElement: HTMLElement | null | undefined
  isComposing: () => boolean
  sendInput: (data: string) => void
}): TerminalImeNativeTextForwarder {
  if (!args.terminalElement) {
    return {
      claimKeyEvent: () => false,
      dispose: () => undefined
    }
  }

  const terminalElement = args.terminalElement
  let pendingForward = false
  let compositionTransactionPending = false
  let claimedPress: ClaimedKeyPress | null = null

  const markCompositionTransactionAccepted = (): void => {
    compositionTransactionPending = true
  }

  const markCompositionTransactionSettled = (): void => {
    compositionTransactionPending = false
  }

  const claimKeyEvent = (event: ImeNativeTextKeyEvent): boolean => {
    if (event.type === 'keydown') {
      if (!isNativeTextKeydown(event, args.isComposing())) {
        return false
      }
      // Why: re-arming here is also what drops a stale claim whose input event
      // never arrived (the input source swallowed the key) — no timer needed.
      pendingForward = true
      claimedPress = { key: event.key, code: event.code }
      return true
    }
    if (!claimedPress) {
      return false
    }
    if (event.ctrlKey || event.altKey || event.metaKey || event.isComposing === true) {
      return false
    }
    if (event.type === 'keyup') {
      if (!matchesClaimedPress(event, claimedPress)) {
        return false
      }
      claimedPress = null
      // Bypass so the kitty release sequence for the swallowed press cannot leak.
      return true
    }
    // Keep the keydown's armed state but still bypass xterm so it does not
    // double-send printable text before our input forward runs.
    return event.type === 'keypress'
  }

  const forwardCommittedText = (event: Event): void => {
    if (!(event instanceof InputEvent)) {
      return
    }
    // Why: an accepted composition transaction already owns its commit; letting
    // it through here would send the text a second time.
    if (compositionTransactionPending && event.inputType === 'insertText') {
      pendingForward = false
      event.stopImmediatePropagation()
      return
    }
    if (!pendingForward) {
      return
    }
    pendingForward = false
    if (event.inputType !== 'insertText') {
      return
    }
    if (event.data) {
      args.sendInput(event.data)
    }
    event.stopImmediatePropagation()
    // Clear the helper textarea so the committed text doesn't accumulate.
    if (event.target instanceof HTMLTextAreaElement) {
      event.target.value = ''
    }
  }

  const cancelPending = (): void => {
    pendingForward = false
    compositionTransactionPending = false
    claimedPress = null
  }

  terminalElement.addEventListener(
    XTERM_COMPOSITION_TRANSACTION_ACCEPTED_EVENT,
    markCompositionTransactionAccepted,
    true
  )
  terminalElement.addEventListener(
    XTERM_COMPOSITION_TRANSACTION_SETTLED_EVENT,
    markCompositionTransactionSettled,
    true
  )
  terminalElement.addEventListener('input', forwardCommittedText, true)
  terminalElement.addEventListener('blur', cancelPending, true)

  return {
    claimKeyEvent,
    dispose: () => {
      cancelPending()
      terminalElement.removeEventListener(
        XTERM_COMPOSITION_TRANSACTION_ACCEPTED_EVENT,
        markCompositionTransactionAccepted,
        true
      )
      terminalElement.removeEventListener(
        XTERM_COMPOSITION_TRANSACTION_SETTLED_EVENT,
        markCompositionTransactionSettled,
        true
      )
      terminalElement.removeEventListener('input', forwardCommittedText, true)
      terminalElement.removeEventListener('blur', cancelPending, true)
    }
  }
}
