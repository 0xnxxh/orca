import { describe, expect, it } from 'vitest'
import {
  resolveTerminalShortcutAction,
  type TerminalShortcutEvent
} from './terminal-shortcut-policy'
import type { OptionKeyLocationState } from '../../lib/keyboard-layout/option-key-location-state'

function event(overrides: Partial<TerminalShortcutEvent>): TerminalShortcutEvent {
  return {
    key: '',
    code: '',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    ...overrides
  }
}

describe('Option-composed characters in kitty keyboard panes', () => {
  const resolveKitty = (
    input: TerminalShortcutEvent,
    macOptionAsAlt: 'true' | 'false' | 'left' | 'right' = 'false',
    optionKeyLocations: OptionKeyLocationState = 0,
    layoutCharacterForCode?: (
      code: string,
      shifted: boolean,
      option?: boolean
    ) => string | undefined,
    kittyKeyboardFlags = 1
  ) =>
    resolveTerminalShortcutAction(
      input,
      true,
      macOptionAsAlt,
      optionKeyLocations,
      false,
      undefined,
      undefined,
      () => kittyKeyboardFlags,
      layoutCharacterForCode
    )

  // Turkish-Q composes '@' on Option+Q and '$' on Option+4. Reporting them as
  // alt+q / alt+4 makes Codex's '@' references and '$' skills untypable (#14024).
  it('types the layout-composed ASCII character instead of reporting a chord', () => {
    expect(resolveKitty(event({ key: '@', code: 'KeyQ', altKey: true }))).toEqual({
      type: 'sendInput',
      data: '@'
    })
    expect(resolveKitty(event({ key: '$', code: 'Digit4', altKey: true }))).toEqual({
      type: 'sendInput',
      data: '$'
    })
  })

  it('types composed ASCII resolved through the active layout map', () => {
    // The map is the layout-true source; Option+Q must still type '@' when it
    // reports the base key rather than the US table doing so.
    const turkish = (code: string): string | undefined => (code === 'KeyQ' ? 'q' : undefined)
    expect(
      resolveKitty(event({ key: '@', code: 'KeyQ', altKey: true }), 'false', 0, turkish)
    ).toEqual({ type: 'sendInput', data: '@' })
  })

  it('types composed ASCII that needs Shift as well', () => {
    // German composes '\' on Option+Shift+7.
    const german = (code: string, shifted: boolean, option = false): string | undefined =>
      code === 'Digit7' ? (option ? '{' : shifted ? '/' : '7') : undefined
    expect(
      resolveKitty(
        event({ key: '\\', code: 'Digit7', altKey: true, shiftKey: true }),
        'false',
        0,
        german
      )
    ).toEqual({ type: 'sendInput', data: '\\' })
  })

  it('keeps Shift-only ASCII as an Option hotkey', () => {
    const latvian = (code: string, shifted: boolean): string | undefined =>
      code === 'Digit2' ? (shifted ? '@' : '2') : undefined
    expect(
      resolveKitty(
        event({ key: '@', code: 'Digit2', altKey: true, shiftKey: true }),
        'false',
        0,
        latvian
      )
    ).toEqual({ type: 'sendInput', data: '\x1b[50;4u' })
  })

  it('still reports non-ASCII Option chords as kitty CSI-u hotkeys', () => {
    // #8031: compose layouts must keep reaching TUI Option hotkeys, and every
    // glyph those layouts compose on a bound key is non-ASCII.
    expect(resolveKitty(event({ key: 'ƒ', code: 'KeyF', altKey: true }))).toEqual({
      type: 'sendInput',
      data: '\x1b[102;3u'
    })
    expect(resolveKitty(event({ key: '∫', code: 'KeyB', altKey: true }))).toEqual({
      type: 'sendInput',
      data: '\x1b[98;3u'
    })
    expect(resolveKitty(event({ key: 'å', code: 'KeyA', altKey: true }))).toEqual({
      type: 'sendInput',
      data: '\x1b[97;3u'
    })
  })

  it('reports a chord when the layout composed nothing and echoed the base key', () => {
    // No composition happened, so this is a hotkey — not a request to type 'q'.
    expect(resolveKitty(event({ key: 'q', code: 'KeyQ', altKey: true }))).toEqual({
      type: 'sendInput',
      data: '\x1b[113;3u'
    })
    expect(resolveKitty(event({ key: 'Q', code: 'KeyQ', altKey: true, shiftKey: true }))).toEqual({
      type: 'sendInput',
      data: '\x1b[113;4u'
    })
  })

  it('keeps the configured Alt-side Option a hotkey even when the layout composed ASCII', () => {
    // The user asked for left Option to be Alt; macOS still composes, but their setting wins.
    expect(resolveKitty(event({ key: '@', code: 'KeyQ', altKey: true }), 'left', 1)).toEqual({
      type: 'sendInput',
      data: '\x1b[113;3u'
    })
    // The compose-side Option in the same mode still types the character.
    expect(resolveKitty(event({ key: '@', code: 'KeyQ', altKey: true }), 'left', 2)).toEqual({
      type: 'sendInput',
      data: '@'
    })
  })

  it('keeps unknown or dual Option state conservative in side-specific modes', () => {
    const chord = event({ key: '@', code: 'KeyQ', altKey: true })
    expect(resolveKitty(chord, 'left', 0)).toEqual({ type: 'sendInput', data: '\x1b[113;3u' })
    expect(resolveKitty(chord, 'left', 3)).toEqual({ type: 'sendInput', data: '\x1b[113;3u' })
  })

  it.each([8, 9, 10, 15, 24])('preserves report-all kitty flags %i', (flags) => {
    const action = resolveKitty(
      event({ key: '@', code: 'KeyQ', altKey: true }),
      'false',
      0,
      undefined,
      flags
    )
    expect(action).toMatchObject({ type: 'sendInput', data: '\x1b[113;3u' })
    expect(action?.type === 'sendInput' ? action.optionKittyRelease : undefined).toEqual(
      (flags & 2) === 0 ? undefined : { flags, primaryCodePoint: 113, modifiers: 3 }
    )
  })

  it('pairs raw composed text with a native-Option kitty release', () => {
    expect(
      resolveKitty(event({ key: '@', code: 'KeyQ', altKey: true }), 'false', 0, undefined, 2)
    ).toEqual({
      type: 'sendInput',
      data: '@',
      optionKittyRelease: { flags: 2, primaryCodePoint: 64, modifiers: 1 }
    })
  })

  it('preserves the Option and Shift layout layers in alternate-key releases', () => {
    const german = (code: string, shifted: boolean, option = false): string | undefined =>
      code === 'Digit7' ? (option ? '{' : shifted ? '/' : '7') : undefined
    expect(
      resolveKitty(
        event({ key: '\\', code: 'Digit7', altKey: true, shiftKey: true }),
        'false',
        0,
        german,
        6
      )
    ).toEqual({
      type: 'sendInput',
      data: '\\',
      optionKittyRelease: {
        flags: 6,
        primaryCodePoint: 123,
        shiftedCodePoint: 92,
        baseCodePoint: 55,
        modifiers: 2
      }
    })
  })

  it('keeps a shifted chord when event reporting cannot pair the composed release', () => {
    const germanWithoutOptionLayer = (
      code: string,
      shifted: boolean,
      option = false
    ): string | undefined =>
      option ? undefined : code === 'Digit7' ? (shifted ? '/' : '7') : undefined
    expect(
      resolveKitty(
        event({ key: '\\', code: 'Digit7', altKey: true, shiftKey: true }),
        'false',
        0,
        germanWithoutOptionLayer,
        2
      )
    ).toEqual({
      type: 'sendInput',
      data: '\x1b[55;4u',
      optionKittyRelease: { flags: 2, primaryCodePoint: 55, modifiers: 4 }
    })
  })
})
