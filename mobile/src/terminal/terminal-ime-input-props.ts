export type TerminalImePlatform = 'android' | 'ios' | 'web' | 'windows' | 'macos'

/** Tri-state: `unset` still needs a per-platform default, so it can't collapse to a boolean. */
export type TerminalAutocompletePreference = 'on' | 'off' | 'unset'

export type TerminalImeInputProps = {
  readonly autoCorrect: boolean
  readonly spellCheck: boolean
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
  platform: TerminalImePlatform,
  preference: TerminalAutocompletePreference
): boolean {
  if (preference !== 'unset') {
    return preference === 'on'
  }
  // Why: iOS phones type agent prompts into the buffered command bar, which is reviewed
  // before send, so autocorrect helps there (#4606). Everywhere else keeps the old
  // raw-keystrokes default.
  return platform === 'ios'
}

export function getTerminalImeInputProps(
  platform: TerminalImePlatform,
  preference: TerminalAutocompletePreference
): TerminalImeInputProps {
  const enabled = isTerminalAutocorrectEnabled(platform, preference)
  return { autoCorrect: enabled, spellCheck: enabled }
}

// Why: Android caches IME inputType at mount, so the remount key must change exactly when
// the emitted props change. Deriving it from the props themselves keeps the two in step.
export function getTerminalImeRemountKey(
  platform: TerminalImePlatform,
  preference: TerminalAutocompletePreference
): string {
  if (platform !== 'android') {
    return 'command-input'
  }
  const { autoCorrect } = getTerminalImeInputProps(platform, preference)
  return `command-input-ac-${String(autoCorrect)}`
}
