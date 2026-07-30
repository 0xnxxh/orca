import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  getTerminalImeInputProps,
  getTerminalImeRemountKey,
  isTerminalAutocorrectEnabled,
  parseTerminalAutocompletePreference,
  type TerminalAutocompletePreference,
  type TerminalImePlatform
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
const PLATFORMS: readonly TerminalImePlatform[] = ['android', 'ios', 'web', 'windows', 'macos']

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
  // #4606: command-bar entry is buffered and reviewed before send, so iOS gets
  // phone-style typing by default.
  it('defaults command-bar autocorrect on for iOS and off elsewhere', () => {
    expect(isTerminalAutocorrectEnabled('ios', 'unset')).toBe(true)
    expect(isTerminalAutocorrectEnabled('android', 'unset')).toBe(false)
    expect(isTerminalAutocorrectEnabled('web', 'unset')).toBe(false)
    expect(isTerminalAutocorrectEnabled('windows', 'unset')).toBe(false)
    expect(isTerminalAutocorrectEnabled('macos', 'unset')).toBe(false)
  })

  it('lets an explicit preference override the per-platform default in both directions', () => {
    expect(isTerminalAutocorrectEnabled('ios', 'off')).toBe(false)
    expect(isTerminalAutocorrectEnabled('android', 'on')).toBe(true)
  })
})

describe('getTerminalImeInputProps', () => {
  it('emits autoCorrect and spellCheck together from the resolved preference', () => {
    for (const platform of PLATFORMS) {
      for (const preference of PREFERENCES) {
        const enabled = isTerminalAutocorrectEnabled(platform, preference)
        expect(getTerminalImeInputProps(platform, preference), `${platform}/${preference}`).toEqual(
          { autoCorrect: enabled, spellCheck: enabled }
        )
      }
    }
  })

  it('defaults the iOS command bar to autocorrect while Android stays raw (#4606)', () => {
    expect(getTerminalImeInputProps('ios', 'unset')).toEqual({
      autoCorrect: true,
      spellCheck: true
    })
    expect(getTerminalImeInputProps('android', 'unset')).toEqual({
      autoCorrect: false,
      spellCheck: false
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
  // Android caches IME inputType at mount, so the key must change exactly when the emitted
  // props change. Deriving it from the props (not a separately-maintained boolean) makes
  // key-vs-props drift structurally impossible.
  it('changes the Android key exactly when the emitted props change', () => {
    for (const a of PREFERENCES) {
      for (const b of PREFERENCES) {
        const sameProps =
          JSON.stringify(getTerminalImeInputProps('android', a)) ===
          JSON.stringify(getTerminalImeInputProps('android', b))
        const sameKey =
          getTerminalImeRemountKey('android', a) === getTerminalImeRemountKey('android', b)
        expect(sameKey, `${a} vs ${b}`).toBe(sameProps)
      }
    }
  })

  it('remounts the Android input when the user opts in to autocorrect', () => {
    expect(getTerminalImeRemountKey('android', 'on')).not.toBe(
      getTerminalImeRemountKey('android', 'unset')
    )
  })

  // iOS updates inputType in place, so remounting would only cost focus and IME state.
  it('keeps one stable key off Android so the input is never remounted', () => {
    for (const platform of ['ios', 'web', 'windows', 'macos'] as const) {
      const keys = PREFERENCES.map((preference) => getTerminalImeRemountKey(platform, preference))
      expect(new Set(keys).size).toBe(1)
    }
  })
})

// These tests scan source text ON PURPOSE — please don't "fix" them by extracting the
// matched expressions into variables. The module above is pure and fully unit-tested; what
// it cannot prove is that the route still *calls* it. Rendering the real screen isn't a
// viable alternative (a 5k-line route behind navigation, RPC and native deps), so these
// guard the wiring instead. They are deliberately narrow: a rename or reflow SHOULD fail
// here and be re-pinned. Known gap: swapping the argument for a different value of the same
// type would still pass — the unit tests above own correctness, these only own the hookup.
describe('session route IME wiring', () => {
  // Element-scoped, not file-scoped: this route has non-terminal inputs of its own.
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

  // Guard the call site: the pure module is only a fix if the route actually uses it.
  it('routes the command input through the IME prop builder', () => {
    expect(commandInput).toContain('getTerminalImeInputProps(Platform.OS, autocompletePref)')
    expect(commandInput).not.toMatch(/autoCorrect=\{/)
    expect(commandInput).not.toMatch(/spellCheck=\{/)
  })

  // The settings copy promises direct input always sends raw keystrokes; the live input
  // must stay hardcoded raw for that sentence to remain true.
  it('keeps the live input hardcoded raw on every platform', () => {
    expect(liveInput).toContain('autoCorrect={false}')
    expect(liveInput).toContain('spellCheck={false}')
  })

  // Android caches inputType at mount, so the key must derive from the emitted props — a
  // separately-maintained boolean can drift from what the input actually received.
  it('derives the command-input remount key from the emitted props, not a boolean', () => {
    expect(commandInput).toContain('key={getTerminalImeRemountKey(Platform.OS, autocompletePref)}')
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
    expect(autocompleteState.match(/isTerminalAutocorrectEnabled\(Platform\.OS,/g)?.length).toBe(2)
    // ...and so must the "On/Off by default" sentence in the group description.
    const groupDescription = sliceBetween(
      terminalSettingsSource,
      'KEYBOARD INPUT',
      'Direct keyboard input'
    )
    expect(groupDescription).toContain('isTerminalAutocorrectEnabled(Platform.OS,')
  })
})
