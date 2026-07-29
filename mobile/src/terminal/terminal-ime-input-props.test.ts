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

// Why: a slice between anchors silently runs to EOF if an anchor rots, which turns
// every assertion below it vacuous — so a missing anchor must fail loudly instead.
function sliceBetween(source: string, startAnchor: string, endAnchor: string): string {
  const start = source.indexOf(startAnchor)
  expect(start, `start anchor not found: ${startAnchor}`).toBeGreaterThan(-1)
  const end = source.indexOf(endAnchor, start)
  expect(end, `end anchor not found after start: ${endAnchor}`).toBeGreaterThan(-1)
  return source.slice(start, end)
}

describe('session route IME wiring', () => {
  // Element-scoped, not file-scoped: ~20 other mobile fields legitimately hardcode
  // autoCorrect={false}, and this route has non-terminal inputs of its own.
  const liveInput = sliceBetween(
    sessionRouteSource,
    'ref={liveInputRef}',
    'importantForAutofill="no"'
  )
  const commandInput = sliceBetween(
    sessionRouteSource,
    'ref={commandInputRef}',
    'onSubmitEditing={() => void handleSend()}'
  )

  // Guard the call sites: the pure module is only a fix if the route actually uses it.
  it('routes both terminal inputs through the IME prop builder', () => {
    expect(liveInput).toContain("getTerminalImeInputProps('live', Platform.OS, autocompletePref)")
    expect(commandInput).toContain(
      "getTerminalImeInputProps('command', Platform.OS, autocompletePref)"
    )
  })

  // #6995: a literal false on either terminal input reintroduces NO_SUGGESTIONS on Android.
  it('hardcodes neither autoCorrect nor spellCheck on either terminal input', () => {
    for (const [name, element] of [
      ['live', liveInput],
      ['command', commandInput]
    ] as const) {
      expect(element, `${name} input`).not.toMatch(/autoCorrect=\{(false|true)\}/)
      expect(element, `${name} input`).not.toMatch(/spellCheck=\{(false|true)\}/)
    }
  })

  // Android caches inputType at mount, so the prop shape and the remount key must flip together.
  it('keys the Android command-input remount off the same resolved value it emits', () => {
    expect(commandInput).toContain('commandAutocorrect')
    expect(sessionRouteSource).toContain(
      "isTerminalAutocorrectEnabled('command', Platform.OS, autocompletePref)"
    )
  })

  // Otherwise the toggle reads "Off" on iOS while the command bar autocorrects (#4606).
  it('resolves the settings toggle and its copy through the same per-platform default', () => {
    const autocompleteState = sliceBetween(
      terminalSettingsSource,
      'const [autocompleteEnabled, setAutocompleteEnabled]',
      'const toggleAutocomplete'
    )
    // Both the initial value and the post-load value must go through the resolver,
    // or the row renders a default the command bar does not actually use.
    expect(autocompleteState).not.toContain('useState(false)')
    expect(
      autocompleteState.match(/isTerminalAutocorrectEnabled\('command', Platform\.OS,/g)?.length
    ).toBe(2)
    // ...and so must the "On/Off by default" sentence in the group description.
    const groupDescription = sliceBetween(terminalSettingsSource, 'KEYBOARD INPUT', 'by default')
    expect(groupDescription).toContain("isTerminalAutocorrectEnabled('command', Platform.OS,")
  })
})
