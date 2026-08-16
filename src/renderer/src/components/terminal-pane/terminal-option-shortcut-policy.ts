import type { OptionKeyLocationState } from '../../lib/keyboard-layout/option-key-location-state'
import {
  KITTY_REPORT_ALTERNATE_KEYS,
  KITTY_REPORT_EVENT_TYPES,
  kittyReportsAllKeysAsEscapeCodes
} from './terminal-kitty-keyboard-flags'
import type { TerminalOptionKittyRelease } from './terminal-option-kitty-release'

export type MacOptionAsAlt = 'true' | 'false' | 'left' | 'right'

type TerminalOptionShortcutEvent = {
  key: string
  code?: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

export type TerminalOptionShortcutAction = {
  type: 'sendInput'
  data: string
  optionKittyRelease?: TerminalOptionKittyRelease
}

type TerminalOptionShortcutContext = {
  isMac: boolean
  macOptionAsAlt: MacOptionAsAlt
  optionKeyLocations: OptionKeyLocationState
  getKittyKeyboardFlags: () => number
  layoutCharacterForCode?: (code: string, shifted: boolean, option?: boolean) => string | undefined
}

const PUNCTUATION_CODE_MAP: Record<string, string> = {
  Period: '.',
  Comma: ',',
  Slash: '/',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Minus: '-',
  Equal: '=',
  Backquote: '`'
}

function kittyAltModifiers(shiftKey: boolean): number {
  return shiftKey ? 4 : 3
}

function singleCodePoint(value: string | undefined): number | undefined {
  return value && [...value].length === 1 ? value.codePointAt(0) : undefined
}

function createOptionKittyRelease(
  flags: number,
  primaryCharacter: string,
  modifiers: number,
  alternates?: { shiftedCharacter?: string; baseCharacter?: string }
): TerminalOptionKittyRelease | undefined {
  if ((flags & KITTY_REPORT_EVENT_TYPES) === 0) {
    return undefined
  }
  const primaryCodePoint = singleCodePoint(primaryCharacter)
  if (primaryCodePoint === undefined) {
    return undefined
  }
  const release: TerminalOptionKittyRelease = { flags, primaryCodePoint, modifiers }
  const shiftedCodePoint = singleCodePoint(alternates?.shiftedCharacter)
  const baseCodePoint = singleCodePoint(alternates?.baseCharacter)
  if (shiftedCodePoint !== undefined) {
    release.shiftedCodePoint = shiftedCodePoint
  }
  if (baseCodePoint !== undefined) {
    release.baseCodePoint = baseCodePoint
  }
  return release
}

function createComposedTextKittyRelease(
  flags: number,
  optionUnshiftedCharacter: string,
  optionShiftedCharacter: string | undefined,
  baseCharacter: string,
  shiftKey: boolean
): TerminalOptionKittyRelease | undefined {
  if ((flags & KITTY_REPORT_ALTERNATE_KEYS) === 0) {
    return createOptionKittyRelease(flags, optionUnshiftedCharacter, shiftKey ? 2 : 1)
  }
  if (!shiftKey) {
    return createOptionKittyRelease(
      flags,
      optionUnshiftedCharacter,
      1,
      optionUnshiftedCharacter === baseCharacter ? undefined : { baseCharacter }
    )
  }
  if (!optionShiftedCharacter) {
    return undefined
  }
  const alternates =
    optionUnshiftedCharacter === baseCharacter
      ? optionShiftedCharacter === optionUnshiftedCharacter
        ? undefined
        : { shiftedCharacter: optionShiftedCharacter }
      : { shiftedCharacter: optionShiftedCharacter, baseCharacter }
  return createOptionKittyRelease(flags, optionUnshiftedCharacter, 2, alternates)
}

function isLayoutComposedAsciiCharacter(key: string, characterWithoutOption: string): boolean {
  if (key.length !== 1) {
    return false
  }
  const codePoint = key.codePointAt(0) as number
  return (
    codePoint > 0x20 &&
    codePoint <= 0x7e &&
    key.toLowerCase() !== characterWithoutOption.toLowerCase()
  )
}

function resolveUnshiftedCharacterForCode(code: string | undefined): string | undefined {
  if (!code) {
    return undefined
  }
  if (code.startsWith('Key') && code.length === 4) {
    return code.charAt(3).toLowerCase()
  }
  if (code.startsWith('Digit') && code.length === 6) {
    return code.charAt(5)
  }
  return PUNCTUATION_CODE_MAP[code]
}

export function resolveTerminalOptionShortcutAction(
  event: TerminalOptionShortcutEvent,
  context: TerminalOptionShortcutContext
): TerminalOptionShortcutAction | null {
  if (
    !context.isMac ||
    event.metaKey ||
    event.ctrlKey ||
    !event.altKey ||
    context.macOptionAsAlt === 'true'
  ) {
    return null
  }
  const isLeftOption = (context.optionKeyLocations & 1) !== 0
  const isRightOption = (context.optionKeyLocations & 2) !== 0
  const shouldActAsMeta =
    (context.macOptionAsAlt === 'left' && isLeftOption) ||
    (context.macOptionAsAlt === 'right' && isRightOption)
  const canSendComposedText =
    context.macOptionAsAlt === 'false' ||
    (context.macOptionAsAlt === 'left' && !isLeftOption && isRightOption) ||
    (context.macOptionAsAlt === 'right' && isLeftOption && !isRightOption)

  const kittyKeyboardFlags = context.getKittyKeyboardFlags()
  if (event.key !== 'Dead' && kittyKeyboardFlags > 0) {
    const baseCharacter =
      (event.code ? context.layoutCharacterForCode?.(event.code, false) : undefined) ??
      resolveUnshiftedCharacterForCode(event.code)
    if (baseCharacter) {
      const characterWithoutOption = event.code
        ? (context.layoutCharacterForCode?.(event.code, event.shiftKey) ??
          (!event.shiftKey ? baseCharacter : undefined))
        : undefined
      if (
        !kittyReportsAllKeysAsEscapeCodes(kittyKeyboardFlags) &&
        canSendComposedText &&
        characterWithoutOption &&
        isLayoutComposedAsciiCharacter(event.key, characterWithoutOption)
      ) {
        const optionUnshiftedCharacter = event.shiftKey
          ? event.code
            ? context.layoutCharacterForCode?.(event.code, false, true)
            : undefined
          : event.key
        const optionKittyRelease = optionUnshiftedCharacter
          ? createComposedTextKittyRelease(
              kittyKeyboardFlags,
              optionUnshiftedCharacter,
              event.shiftKey ? event.key : undefined,
              baseCharacter,
              event.shiftKey
            )
          : undefined
        // Why: a swallowed press with event reporting must own its matching release too.
        if ((kittyKeyboardFlags & KITTY_REPORT_EVENT_TYPES) === 0 || optionKittyRelease) {
          return { type: 'sendInput', data: event.key, optionKittyRelease }
        }
      }
      const modifiers = kittyAltModifiers(event.shiftKey)
      return {
        type: 'sendInput',
        data: `\x1b[${baseCharacter.codePointAt(0)};${modifiers}u`,
        optionKittyRelease: createOptionKittyRelease(kittyKeyboardFlags, baseCharacter, modifiers)
      }
    }
  }

  if (!event.shiftKey) {
    if (shouldActAsMeta) {
      const character = resolveUnshiftedCharacterForCode(event.code)
      if (character) {
        return { type: 'sendInput', data: `\x1b${character}` }
      }
    }
    if (!shouldActAsMeta) {
      if (event.code === 'KeyB') {
        return { type: 'sendInput', data: '\x1bb' }
      }
      if (event.code === 'KeyF') {
        return { type: 'sendInput', data: '\x1bf' }
      }
      if (event.code === 'KeyD') {
        return { type: 'sendInput', data: '\x1bd' }
      }
    }
  }
  return null
}
