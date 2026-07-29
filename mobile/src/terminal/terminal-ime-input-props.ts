export type TerminalImePlatform = 'android' | 'ios' | 'web' | 'windows' | 'macos'

/** `live` streams keystrokes straight to the PTY; `command` buffers a line until send. */
export type TerminalInputEntryMode = 'live' | 'command'

/** Tri-state: `unset` still needs a per-platform default, so it can't collapse to a boolean. */
export type TerminalAutocompletePreference = 'on' | 'off' | 'unset'

export type TerminalImeInputProps = {
  readonly autoCorrect?: boolean
  readonly spellCheck?: boolean
}

export function parseTerminalAutocompletePreference(
  raw: string | null | undefined
): TerminalAutocompletePreference {
  if (raw === 'true') {
    return 'on'
  }
  if (raw === 'false') {
    return 'off'
  }
  return 'unset'
}

export function isTerminalAutocorrectEnabled(
  entryMode: TerminalInputEntryMode,
  platform: TerminalImePlatform,
  preference: TerminalAutocompletePreference
): boolean {
  // Why: direct keystrokes reach the shell with no review step, so a correction there
  // is unrecoverable; the settings copy promises direct input always stays raw.
  if (entryMode === 'live') {
    return false
  }
  if (preference !== 'unset') {
    return preference === 'on'
  }
  // Why: iOS phones are used to type agent prompts into the buffered command bar, which
  // is reviewed before send, so autocorrect helps there (#4606). Android keeps the old
  // default because its suggestion strip already commits inline.
  return platform === 'ios'
}

export function getTerminalImeInputProps(
  entryMode: TerminalInputEntryMode,
  platform: TerminalImePlatform,
  preference: TerminalAutocompletePreference
): TerminalImeInputProps {
  const enabled = isTerminalAutocorrectEnabled(entryMode, platform, preference)
  if (platform === 'android') {
    // Why: React Native turns autoCorrect={false} into Android's NO_SUGGESTIONS inputType,
    // and Samsung Keyboard answers that flag by switching IME composition off entirely —
    // Hangul then arrives as raw jamo (#6995). Omitting the prop drops the flag without
    // asking for autocorrect. spellCheck is iOS-only, so it stays off the Android path.
    if (enabled) {
      return { autoCorrect: true }
    }
    // Why: an Off switch that emitted the same props as untouched would be a control that
    // does nothing, leaving no way back to suppression. Honour it with NO_SUGGESTIONS even
    // though that costs IME composition — the user asked, and it is reversible. Only the
    // command bar, because the toggle never claimed to govern direct entry.
    if (preference === 'off' && entryMode === 'command') {
      return { autoCorrect: false }
    }
    return {}
  }
  return { autoCorrect: enabled, spellCheck: enabled }
}

// Why: Android caches IME inputType at mount, so the remount key must change whenever the
// emitted props change — and on Android that is a three-way split ({} vs true vs false), not
// the boolean the key used to track. Keying off the props themselves keeps the two in step.
export function getTerminalImeRemountKey(
  entryMode: TerminalInputEntryMode,
  platform: TerminalImePlatform,
  preference: TerminalAutocompletePreference
): string {
  if (platform !== 'android') {
    return `${entryMode}-input`
  }
  const { autoCorrect } = getTerminalImeInputProps(entryMode, platform, preference)
  return `${entryMode}-input-ac-${autoCorrect === undefined ? 'omitted' : String(autoCorrect)}`
}
