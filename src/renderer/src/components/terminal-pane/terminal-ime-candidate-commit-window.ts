import type { IDisposable } from '@xterm/xterm'
import {
  clearTerminalImePendingCandidateKeyRelease,
  createTerminalImePendingCandidateKeyReleases,
  shouldApplyTerminalImePendingCandidateKeyRelease
} from './terminal-ime-candidate-key-release-guard'
import { TERMINAL_IME_CANDIDATE_GUARD_POST_COMPOSITION_MS } from './terminal-ime-composition-tracker'
import type { XtermBypassEvent } from './xterm-bypass-policy'

export type TerminalImeCandidateCommitWindow = IDisposable & {
  /** True when this event is the committing candidate key's own trailing press or release. */
  shouldAbsorbKeyEvent: (event: XtermBypassEvent, now: number) => boolean
  /** Advances the state after a classification is consumed; call for every pane key event. */
  observeKeyboardEvent: (event: XtermBypassEvent) => void
}

// Why by physical code: `key` reads "Process" while the IME owns the press, so
// only `code` still identifies which selector the user pressed.
const CANDIDATE_SELECTION_KEY_BY_CODE = new Map<string, string>([
  ['Space', ' '],
  ...Array.from({ length: 10 }, (_, digit): [string, string] => [`Digit${digit}`, String(digit)]),
  ...Array.from({ length: 10 }, (_, digit): [string, string] => [`Numpad${digit}`, String(digit)])
])

/** Returns whether the IME, not the keyboard layout, owns this keystroke. */
function isImeOwnedKeydown(event: XtermBypassEvent): boolean {
  return event.isComposing === true || event.keyCode === 229 || event.key === 'Process'
}

/**
 * Arms the post-compositionend candidate-key absorption from evidence IBus
 * actually provides.
 *
 * Recorded IBus candidate picks (`__fixtures__/ibus-chinese-candidate-digit-terminal-trace.json`)
 * deliver the selector keydown as Process/229 and its release as a bare digit
 * *after* compositionend, and never emit the empty compositionupdate that
 * `terminal-ime-composition-tracker` needs to arm its window. The selector
 * still being held when the composition ends is the signal that is present.
 *
 * Absorption reuses the pending-release rules, so only that key's trailing
 * press/release is taken — a fresh press of the same key is left alone.
 */
export function installTerminalImeCandidateCommitWindow(args: {
  terminalElement: HTMLElement | null | undefined
  now?: () => number
}): TerminalImeCandidateCommitWindow {
  const now = args.now ?? ((): number => Date.now())
  const heldCandidateKeysByCode = new Map<string, string>()
  const pendingReleases = createTerminalImePendingCandidateKeyReleases()

  const shouldAbsorbKeyEvent = (event: XtermBypassEvent, at: number): boolean =>
    shouldApplyTerminalImePendingCandidateKeyRelease(event, pendingReleases, at)

  const observeKeyboardEvent = (event: XtermBypassEvent): void => {
    clearTerminalImePendingCandidateKeyRelease(pendingReleases, event)
    const code = event.code
    const candidateKey = code ? CANDIDATE_SELECTION_KEY_BY_CODE.get(code) : undefined
    if (!code || candidateKey === undefined) {
      return
    }
    if (event.type === 'keydown') {
      if (isImeOwnedKeydown(event)) {
        heldCandidateKeysByCode.set(code, candidateKey)
      } else {
        // Ordinary typing on the same physical key must not look like a pick.
        heldCandidateKeysByCode.delete(code)
      }
      return
    }
    if (event.type === 'keyup') {
      heldCandidateKeysByCode.delete(code)
    }
  }

  const handleCompositionEnd = (): void => {
    const expiresAt = now() + TERMINAL_IME_CANDIDATE_GUARD_POST_COMPOSITION_MS
    for (const candidateKey of heldCandidateKeysByCode.values()) {
      pendingReleases.set(candidateKey, expiresAt)
    }
  }

  const reset = (): void => {
    heldCandidateKeysByCode.clear()
    pendingReleases.clear()
  }

  const terminalElement = args.terminalElement
  if (!terminalElement) {
    return { shouldAbsorbKeyEvent, observeKeyboardEvent, dispose: () => undefined }
  }
  terminalElement.addEventListener('compositionend', handleCompositionEnd, true)
  terminalElement.addEventListener('blur', reset, true)
  return {
    shouldAbsorbKeyEvent,
    observeKeyboardEvent,
    dispose: () => {
      reset()
      terminalElement.removeEventListener('compositionend', handleCompositionEnd, true)
      terminalElement.removeEventListener('blur', reset, true)
    }
  }
}
