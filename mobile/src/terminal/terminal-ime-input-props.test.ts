import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  getTerminalImeInputProps,
  getTerminalImeRemountKey,
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
  // The one deliberate exception is an explicit command-bar Off — the user asked for
  // suppression and it is reversible. Nothing else on Android may emit the flag.
  it('emits an explicit false autoCorrect on Android only where the user asked for it', () => {
    for (const entryMode of ['live', 'command'] as const) {
      for (const preference of PREFERENCES) {
        const props = getTerminalImeInputProps(entryMode, 'android', preference)
        expect(props.autoCorrect === false, `${entryMode}/${preference}`).toBe(
          entryMode === 'command' && preference === 'off'
        )
      }
    }
  })

  it('omits autoCorrect entirely on Android when the preference is untouched', () => {
    expect(getTerminalImeInputProps('live', 'android', 'unset')).toEqual({})
    expect(getTerminalImeInputProps('command', 'android', 'unset')).toEqual({})
  })

  // Otherwise Off emits the same props as untouched — a control that does nothing, with no
  // way back to suppression. It costs IME composition, which is the point of asking.
  it('honours an explicit Android Off instead of making the switch a no-op', () => {
    expect(getTerminalImeInputProps('command', 'android', 'off')).toEqual({ autoCorrect: false })
    expect(getTerminalImeInputProps('command', 'android', 'off')).not.toEqual(
      getTerminalImeInputProps('command', 'android', 'unset')
    )
  })

  // The toggle never claimed to govern direct entry, and #6995 was reported on the live path,
  // so an explicit Off must not reintroduce NO_SUGGESTIONS there.
  it('keeps Android direct entry composing even when the user turned autocorrect off', () => {
    for (const preference of PREFERENCES) {
      expect(getTerminalImeInputProps('live', 'android', preference)).toEqual({})
    }
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

describe('getTerminalImeRemountKey', () => {
  // Android caches inputType at mount. Before the explicit-Off case existed the key tracked a
  // boolean, which cannot distinguish {} from {autoCorrect:false} — so unset -> off would have
  // kept the key and the user's Off would never have reached the IME.
  it('gives every distinct Android prop shape a distinct key', () => {
    const keys = PREFERENCES.map((preference) =>
      getTerminalImeRemountKey('command', 'android', preference)
    )
    expect(new Set(keys).size).toBe(PREFERENCES.length)
  })

  it('changes the Android key exactly when the emitted props change', () => {
    for (const a of PREFERENCES) {
      for (const b of PREFERENCES) {
        const sameProps =
          JSON.stringify(getTerminalImeInputProps('command', 'android', a)) ===
          JSON.stringify(getTerminalImeInputProps('command', 'android', b))
        const sameKey =
          getTerminalImeRemountKey('command', 'android', a) ===
          getTerminalImeRemountKey('command', 'android', b)
        expect(sameKey, `${a} vs ${b}`).toBe(sameProps)
      }
    }
  })

  // iOS updates inputType in place, so remounting would only cost focus and IME state.
  it('keeps one stable key off Android so the input is never remounted', () => {
    for (const platform of ['ios', 'web', 'windows', 'macos'] as const) {
      const keys = PREFERENCES.map((preference) =>
        getTerminalImeRemountKey('command', platform, preference)
      )
      expect(new Set(keys).size).toBe(1)
    }
  })
})

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

  // Android caches inputType at mount, so the key must derive from the emitted props. A key
  // computed from the boolean instead cannot tell {} from {autoCorrect:false}, and an explicit
  // Off would silently never reach the IME.
  it('derives the command-input remount key from the emitted props, not a boolean', () => {
    expect(commandInput).toContain(
      "key={getTerminalImeRemountKey('command', Platform.OS, autocompletePref)}"
    )
    expect(commandInput).not.toMatch(/key=\{[^}]*commandAutocorrect/)
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
