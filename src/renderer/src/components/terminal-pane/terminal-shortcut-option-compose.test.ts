import { describe, expect, it } from 'vitest'
import {
  resolveTerminalShortcutAction,
  type TerminalShortcutEvent
} from './terminal-shortcut-policy'

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
  const kittyActive = (): boolean => true

  const resolveKitty = (
    input: TerminalShortcutEvent,
    macOptionAsAlt: 'true' | 'false' | 'left' | 'right' = 'false',
    optionKeyLocation = 0,
    layoutBaseCharacterForCode?: (code: string) => string | undefined
  ) =>
    resolveTerminalShortcutAction(
      input,
      true,
      macOptionAsAlt,
      optionKeyLocation,
      false,
      undefined,
      undefined,
      kittyActive,
      layoutBaseCharacterForCode
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
    expect(
      resolveKitty(event({ key: '\\', code: 'Digit7', altKey: true, shiftKey: true }))
    ).toEqual({ type: 'sendInput', data: '\\' })
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
})
