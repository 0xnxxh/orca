import { isImeCompositionKeyDown } from '@/lib/ime-composition-keyboard-event'

type ResolvedShortcutAction = { readonly type: string } | null

/**
 * True when an IME owns this keydown, so no terminal shortcut may act on it.
 *
 * The window-capture handler runs before the pane's own key handler and stops
 * propagation on a match, so a chord resolved here is the only thing the keystroke
 * will ever do. Ctrl+Backspace mid-preedit reaches the PTY as `\x17` and erases a word
 * of the real command line behind the candidate window; the IME's buffer is untouched.
 * The non-Latin fallback makes it worse by re-deriving bindings from `event.code`, so
 * even a keystroke reported as `Process` still matches Ctrl+W and closes the pane.
 *
 * The input-source switch is always exempt: it only hands the key back to the OS.
 * Dropping it here would let xterm see the chord instead and write its control byte to
 * the PTY, which is the very failure this guard exists to prevent.
 *
 * Enter is exempt only for a caller that defers it, which is a property of the caller
 * and not of the key. A surface with a defer path needs Enter to arrive so the newline
 * can be released after the commit; a surface without one needs Enter suppressed, so
 * the keystroke commits the composition instead of submitting a line the user was
 * still composing.
 *
 * That exemption belongs to the action that defers, not to the key shape: `sendInput` is
 * the only branch that holds its newline until the commit. `Mod+Shift+Enter` is bound to
 * expand a pane by default, and any terminal action can be rebound onto an Enter chord —
 * exempting those would run them mid-preedit, which is the whole failure this guard exists
 * to stop.
 *
 * Resolution is pure, so asking for the action before deciding costs nothing.
 */
export function terminalShortcutIsOwnedByIme(
  event: KeyboardEvent,
  resolveAction: (event: KeyboardEvent) => ResolvedShortcutAction,
  { enterIsDeferredToCommit = false }: { enterIsDeferredToCommit?: boolean } = {}
): boolean {
  if (!isImeCompositionKeyDown(event)) {
    return false
  }
  const action = resolveAction(event)
  if (action?.type === 'switchInputSource') {
    return false
  }
  return !(enterIsDeferredToCommit && event.code === 'Enter' && action?.type === 'sendInput')
}
