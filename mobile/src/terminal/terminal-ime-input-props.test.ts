import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  getTerminalImeInputProps,
  isTerminalAutocorrectEnabled,
  parseTerminalAutocompletePreference,
  type TerminalAutocompletePreference
} from './terminal-ime-input-props'

const sessionRouteSource = readFileSync(
  new URL('../../app/h/[hostId]/session/[worktreeId].tsx', import.meta.url),
  'utf8'
)

const terminalSettingsSource = readFileSync(
  new URL('../../app/terminal-settings.tsx', import.meta.url),
  'utf8'
)

const PREFERENCES: readonly TerminalAutocompletePreference[] = ['on', 'off', 'unset']

describe('parseTerminalAutocompletePreference', () => {
  it('keeps a missing value distinguishable from an explicit off', () => {
    expect(parseTerminalAutocompletePreference(null)).toBe('unset')
    expect(parseTerminalAutocompletePreference(undefined)).toBe('unset')
    expect(parseTerminalAutocompletePreference('false')).toBe('off')
    expect(parseTerminalAutocompletePreference('true')).toBe('on')
  })

  it('treats unrecognized persisted values as unset rather than off', () => {
    expect(parseTerminalAutocompletePreference('')).toBe('unset')
    expect(parseTerminalAutocompletePreference('TRUE')).toBe('unset')
    expect(parseTerminalAutocompletePreference('1')).toBe('unset')
  })
})

describe('isTerminalAutocorrectEnabled', () => {
  it('never enables autocorrect for direct (live) entry on any platform or preference', () => {
    for (const platform of ['android', 'ios', 'web', 'windows', 'macos'] as const) {
      for (const preference of PREFERENCES) {
        expect(isTerminalAutocorrectEnabled('live', platform, preference)).toBe(false)
      }
    }
  })

  // #4606: non-direct entry is reviewed before send, so iOS gets phone-style typing by default.
  it('defaults command-bar autocorrect on for iOS and off elsewhere', () => {
    expect(isTerminalAutocorrectEnabled('command', 'ios', 'unset')).toBe(true)
    expect(isTerminalAutocorrectEnabled('command', 'android', 'unset')).toBe(false)
    expect(isTerminalAutocorrectEnabled('command', 'web', 'unset')).toBe(false)
  })

  it('lets an explicit preference override the per-platform default in both directions', () => {
    expect(isTerminalAutocorrectEnabled('command', 'ios', 'off')).toBe(false)
    expect(isTerminalAutocorrectEnabled('command', 'android', 'on')).toBe(true)
  })
})

describe('getTerminalImeInputProps', () => {
  // #6995: RN maps autoCorrect={false} to Android's NO_SUGGESTIONS inputType, and Samsung
  // Keyboard answers that flag by disabling IME composition — Hangul arrives as raw jamo.
  it('never emits an explicit false autoCorrect on Android', () => {
    for (const entryMode of ['live', 'command'] as const) {
      for (const preference of PREFERENCES) {
        const props = getTerminalImeInputProps(entryMode, 'android', preference)
        expect(props.autoCorrect).not.toBe(false)
        expect(Object.hasOwn(props, 'autoCorrect')).toBe(
          isTerminalAutocorrectEnabled(entryMode, 'android', preference)
        )
      }
    }
  })

  it('omits autoCorrect entirely on Android when suggestions stay suppressed', () => {
    expect(getTerminalImeInputProps('live', 'android', 'unset')).toEqual({})
    expect(getTerminalImeInputProps('command', 'android', 'off')).toEqual({})
  })

  it('still opts Android into autocorrect when the user asked for it', () => {
    expect(getTerminalImeInputProps('command', 'android', 'on')).toEqual({ autoCorrect: true })
  })

  // spellCheck is iOS-only in RN, so it must not ride along on the Android path.
  it('keeps spellCheck off the Android props entirely', () => {
    for (const preference of PREFERENCES) {
      expect(
        Object.hasOwn(getTerminalImeInputProps('command', 'android', preference), 'spellCheck')
      ).toBe(false)
    }
  })

  it('keeps iOS direct entry raw while defaulting the command bar to autocorrect', () => {
    expect(getTerminalImeInputProps('live', 'ios', 'unset')).toEqual({
      autoCorrect: false,
      spellCheck: false
    })
    expect(getTerminalImeInputProps('command', 'ios', 'unset')).toEqual({
      autoCorrect: true,
      spellCheck: true
    })
  })
})

describe('session route IME wiring', () => {
  // Guard the call sites: the pure module is only a fix if the route actually uses it.
  it('routes both terminal inputs through the IME prop builder', () => {
    expect(sessionRouteSource).toContain(
      "{...getTerminalImeInputProps('live', Platform.OS, autocompletePref)}"
    )
    expect(sessionRouteSource).toContain(
      "{...getTerminalImeInputProps('command', Platform.OS, autocompletePref)}"
    )
  })

  it('hardcodes neither autoCorrect nor spellCheck on the terminal inputs', () => {
    expect(sessionRouteSource).not.toContain('autoCorrect={false}')
    expect(sessionRouteSource).not.toContain('spellCheck={false}')
    expect(sessionRouteSource).not.toContain('autoCorrect={autocompleteEnabled}')
  })

  // Otherwise the toggle reads "Off" on iOS while the command bar autocorrects (#4606).
  it('resolves the settings toggle through the same per-platform default', () => {
    expect(terminalSettingsSource).toContain("isTerminalAutocorrectEnabled('command', Platform.OS,")
    expect(terminalSettingsSource).not.toContain(
      'const [autocompleteEnabled, setAutocompleteEnabled] = useState(false)'
    )
  })
})
