import {
  hasPendingTerminalImeComposition,
  XTERM_COMPOSITION_SESSION_END_EVENT
} from './terminal-ime-composition-route'

export const TERMINAL_IME_DEFERRED_NEWLINE_FALLBACK_MS = 200

// Ceiling for a composition that stops making progress. Measured from the last
// compositionupdate, not from the start: multi-segment bunsetsu conversion keeps a
// Japanese composition legitimately pending far longer than this, and finishing on a
// total-elapsed ceiling would split it with the newline this deferral exists to hold back.
// At the ceiling the newline is dropped, not sent — see `abandon` below.
export const TERMINAL_IME_DEFERRED_NEWLINE_MAX_IDLE_MS = 2000

export function sendTerminalInputAfterComposition(
  terminalElement: HTMLElement | null | undefined,
  send: () => void,
  options?: { fallbackMs?: number; maxIdleMs?: number; onAbandon?: () => void }
): void {
  if (!terminalElement) {
    window.setTimeout(send, 0)
    return
  }

  const fallbackMs = Math.max(1, options?.fallbackMs ?? TERMINAL_IME_DEFERRED_NEWLINE_FALLBACK_MS)
  const maxIdleMs = Math.max(
    fallbackMs,
    options?.maxIdleMs ?? TERMINAL_IME_DEFERRED_NEWLINE_MAX_IDLE_MS
  )
  let done = false
  let idleMs = 0

  const settle = (): boolean => {
    if (done) {
      return false
    }
    done = true
    terminalElement.removeEventListener('compositionend', onCompositionEnd)
    terminalElement.removeEventListener('compositionupdate', onCompositionUpdate)
    terminalElement.removeEventListener(
      XTERM_COMPOSITION_SESSION_END_EVENT,
      onCompositionSessionEnd
    )
    window.clearTimeout(fallbackTimer)
    return true
  }

  const finish = (): void => {
    if (settle()) {
      // xterm flushes the committed glyph after compositionend.
      window.setTimeout(send, 0)
    }
  }

  /** Give up on the newline without emitting it, releasing the caller's bookkeeping. */
  const abandon = (): void => {
    if (settle()) {
      options?.onAbandon?.()
    }
  }

  const finishAfterPendingComposition = (): void => {
    if (!hasPendingTerminalImeComposition(terminalElement)) {
      finish()
    }
  }
  const onCompositionEnd = (): void => finishAfterPendingComposition()
  const onCompositionSessionEnd = (): void => finishAfterPendingComposition()
  // Each preedit change proves the composition is still progressing, so the idle
  // ceiling only ever expires on a composition that is genuinely stuck.
  let sawRecentUpdate = false
  const onCompositionUpdate = (): void => {
    idleMs = 0
    sawRecentUpdate = true
  }
  terminalElement.addEventListener('compositionend', onCompositionEnd)
  terminalElement.addEventListener('compositionupdate', onCompositionUpdate)
  terminalElement.addEventListener(XTERM_COMPOSITION_SESSION_END_EVENT, onCompositionSessionEnd)

  // Re-arm rather than sending: firing mid-composition splits the preedit with a newline.
  const onFallbackDeadline = (): void => {
    idleMs += fallbackMs
    // A live compositionupdate counts as evidence on its own: a route installed while a
    // composition was already in flight never saw that session start, so it has nothing
    // recorded to report as pending.
    const compositionInProgress =
      hasPendingTerminalImeComposition(terminalElement) || sawRecentUpdate
    sawRecentUpdate = false
    if (!compositionInProgress) {
      finish()
      return
    }
    if (idleMs >= maxIdleMs) {
      // Why: reaching the ceiling only proves the preedit stopped changing — the route still
      // positively reports it live, and a user reading candidates is not a stuck composition.
      // Dropping the newline costs one repeatable keypress; splitting a live preedit does not
      // undo. Emit nothing while the evidence says a composition is still open.
      abandon()
      return
    }
    fallbackTimer = window.setTimeout(onFallbackDeadline, fallbackMs)
  }
  let fallbackTimer = window.setTimeout(onFallbackDeadline, fallbackMs)
}

export type TerminalImeDeferredNewlineSender = {
  defer: (
    enter: TerminalImeEnterIdentity,
    terminalElement: HTMLElement | null | undefined,
    send: () => void
  ) => void
  absorbRedispatchedEnter: (enter: TerminalImeEnterIdentity) => boolean
  releaseRedispatchedEnter: (enter: TerminalImeEnterIdentity) => void
  clearRedispatchedEnters: () => void
}

export type TerminalImeEnterIdentity = Pick<KeyboardEvent, 'code' | 'timeStamp'>

export type TerminalImeModifiedEnterKind = 'shift' | 'ctrl'

export type TerminalImeModifiedEnterChord = TerminalImeEnterIdentity & {
  kind: TerminalImeModifiedEnterKind
}

export type TerminalImeModifiedEnterChordOwner = {
  claim: (chord: TerminalImeModifiedEnterChord) => boolean
  absorb: (chord: TerminalImeModifiedEnterChord) => boolean
  release: (chord: TerminalImeModifiedEnterChord) => void
  clear: () => void
}

export function createTerminalImeModifiedEnterChordOwner(): TerminalImeModifiedEnterChordOwner {
  let activeKind: TerminalImeModifiedEnterKind | null = null

  return {
    claim: ({ kind }) => {
      if (activeKind !== null) {
        return false
      }
      activeKind = kind
      return true
    },
    absorb: ({ kind }) => activeKind === kind,
    release: ({ kind }) => {
      if (activeKind === kind) {
        activeKind = null
      }
    },
    clear: () => {
      activeKind = null
    }
  }
}

export function getTerminalImeModifiedEnterKind(
  event: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>
): TerminalImeModifiedEnterKind | null {
  if (event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
    return 'shift'
  }
  if (event.ctrlKey && !event.shiftKey && !event.metaKey && !event.altKey) {
    return 'ctrl'
  }
  return null
}

export function isTerminalImeProcessEnter(
  event: Pick<
    KeyboardEvent,
    'key' | 'code' | 'keyCode' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'
  >
): boolean {
  return (
    event.key === 'Process' &&
    event.keyCode === 229 &&
    // Windows reports every IME-consumed key as Process/229; only code proves physical Enter.
    (event.code === 'Enter' || event.code === 'NumpadEnter') &&
    getTerminalImeModifiedEnterKind(event) !== null
  )
}

export function isTerminalImeEnterKeyUp(event: Pick<KeyboardEvent, 'key' | 'keyCode'>): boolean {
  return event.key === 'Enter' && event.keyCode === 13
}

type DeferredNewlineState = {
  inFlightSends: number
  absorbCredits: number
}

export function createTerminalImeDeferredNewlineSender(): TerminalImeDeferredNewlineSender {
  const statesByEnterCode = new Map<string, Map<number, DeferredNewlineState>>()

  const cleanUpIfSettled = (enter: TerminalImeEnterIdentity, state: DeferredNewlineState): void => {
    if (state.inFlightSends <= 0 && state.absorbCredits <= 0) {
      const statesByTimeStamp = statesByEnterCode.get(enter.code)
      statesByTimeStamp?.delete(enter.timeStamp)
      if (statesByTimeStamp?.size === 0) {
        statesByEnterCode.delete(enter.code)
      }
    }
  }

  const clearCreditsForCode = (enterCode: string): void => {
    const statesByTimeStamp = statesByEnterCode.get(enterCode)
    if (!statesByTimeStamp) {
      return
    }
    for (const [timeStamp, state] of statesByTimeStamp) {
      state.absorbCredits = 0
      cleanUpIfSettled({ code: enterCode, timeStamp }, state)
    }
  }

  return {
    defer: (enter, terminalElement, send) => {
      const statesByTimeStamp = statesByEnterCode.get(enter.code) ?? new Map()
      const state = statesByTimeStamp.get(enter.timeStamp) ?? {
        inFlightSends: 0,
        absorbCredits: 0
      }
      state.inFlightSends += 1
      state.absorbCredits += 1
      statesByTimeStamp.set(enter.timeStamp, state)
      statesByEnterCode.set(enter.code, statesByTimeStamp)
      sendTerminalInputAfterComposition(
        terminalElement,
        () => {
          state.inFlightSends -= 1
          cleanUpIfSettled(enter, state)
          send()
        },
        {
          onAbandon: () => {
            state.inFlightSends -= 1
            // No commit means no redispatched Enter is coming; a surviving credit would
            // absorb the user's next one instead.
            state.absorbCredits = Math.max(0, state.absorbCredits - 1)
            cleanUpIfSettled(enter, state)
          }
        }
      )
    },
    absorbRedispatchedEnter: (enter) => {
      const state = statesByEnterCode.get(enter.code)?.get(enter.timeStamp)
      if (!state || state.absorbCredits <= 0) {
        clearCreditsForCode(enter.code)
        return false
      }
      state.absorbCredits -= 1
      cleanUpIfSettled(enter, state)
      return true
    },
    releaseRedispatchedEnter: (enter) => {
      if (statesByEnterCode.get(enter.code)?.has(enter.timeStamp)) {
        // Chromium's balancing Process-key keyup is copied from the same native event.
        return
      }
      clearCreditsForCode(enter.code)
    },
    clearRedispatchedEnters: () => {
      for (const enterCode of statesByEnterCode.keys()) {
        clearCreditsForCode(enterCode)
      }
    }
  }
}
