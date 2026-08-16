import {
  KITTY_REPORT_ALL_KEYS_AS_ESCAPE_CODES,
  KITTY_REPORT_ALTERNATE_KEYS,
  KITTY_REPORT_ASSOCIATED_TEXT,
  KITTY_REPORT_EVENT_TYPES
} from '../../../../shared/terminal-kitty-keyboard-flags'

export type TerminalKittyCsiUEventType = 'press' | 'repeat' | 'release'

export type TerminalKittyCsiUEvent = {
  flags: number
  type: TerminalKittyCsiUEventType
  primaryCodePoint: number
  shiftedCodePoint?: number
  baseCodePoint?: number
  shiftKey: boolean
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  capsLock?: boolean
  numLock?: boolean
  associatedText?: string
}

type TerminalOptionKeyboardEvent = {
  key: string
  code?: string
  shiftKey: boolean
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  repeat?: boolean
  getModifierState?: (key: string) => boolean
  capsLock?: boolean
  numLock?: boolean
}

type LayoutCharacterResolver = (
  code: string,
  shifted: boolean,
  option?: boolean
) => string | undefined

const PC_101_PUNCTUATION_BY_CODE: Readonly<Record<string, string>> = {
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
  Backquote: '`',
  Space: ' '
}

export function pc101CharacterForCode(code: string | undefined): string | undefined {
  if (!code) {
    return undefined
  }
  if (code.startsWith('Key') && code.length === 4) {
    return code.charAt(3).toLowerCase()
  }
  if (code.startsWith('Digit') && code.length === 6) {
    return code.charAt(5)
  }
  return PC_101_PUNCTUATION_BY_CODE[code]
}

function singleCodePoint(value: string | undefined): number | undefined {
  return value && [...value].length === 1 ? value.codePointAt(0) : undefined
}

function encodeModifiers(event: TerminalKittyCsiUEvent): number {
  let modifiers = 1
  if (event.shiftKey) {
    modifiers += 1
  }
  if (event.altKey) {
    modifiers += 2
  }
  if (event.ctrlKey) {
    modifiers += 4
  }
  if (event.metaKey) {
    modifiers += 8
  }
  if (event.capsLock) {
    modifiers += 64
  }
  if (event.numLock) {
    modifiers += 128
  }
  return modifiers
}

function associatedTextCodePoints(event: TerminalKittyCsiUEvent): string | undefined {
  if (
    event.type === 'release' ||
    event.ctrlKey ||
    (event.flags & KITTY_REPORT_ALL_KEYS_AS_ESCAPE_CODES) === 0 ||
    (event.flags & KITTY_REPORT_ASSOCIATED_TEXT) === 0 ||
    !event.associatedText
  ) {
    return undefined
  }
  const codePoints = [...event.associatedText]
    .map((character) => character.codePointAt(0) as number)
    .filter((codePoint) => codePoint > 0x1f && (codePoint < 0x7f || codePoint > 0x9f))
  return codePoints.length > 0 ? codePoints.join(':') : undefined
}

export function encodeTerminalKittyCsiU(event: TerminalKittyCsiUEvent): string | null {
  const reportsEventTypes = (event.flags & KITTY_REPORT_EVENT_TYPES) !== 0
  if (event.type === 'release' && !reportsEventTypes) {
    return null
  }

  const keyCodes = [String(event.primaryCodePoint)]
  if ((event.flags & KITTY_REPORT_ALTERNATE_KEYS) !== 0) {
    const shifted =
      event.shiftedCodePoint === event.primaryCodePoint ? undefined : event.shiftedCodePoint
    const base = event.baseCodePoint === event.primaryCodePoint ? undefined : event.baseCodePoint
    if (shifted !== undefined || base !== undefined) {
      keyCodes.push(shifted === undefined ? '' : String(shifted))
    }
    if (base !== undefined) {
      keyCodes.push(String(base))
    }
  }

  const eventType =
    reportsEventTypes && event.type !== 'press' ? (event.type === 'repeat' ? 2 : 3) : undefined
  const textCodePoints = associatedTextCodePoints(event)
  const modifiers = encodeModifiers(event)
  let sequence = `\x1b[${keyCodes.join(':')}`
  if (modifiers > 1 || eventType !== undefined || textCodePoints !== undefined) {
    const encodedModifiers = modifiers > 1 ? String(modifiers) : eventType !== undefined ? '1' : ''
    sequence += `;${encodedModifiers}`
    if (eventType !== undefined) {
      sequence += `:${eventType}`
    }
  }
  if (textCodePoints !== undefined) {
    sequence += `;${textCodePoints}`
  }
  return `${sequence}u`
}

export function encodeTerminalOptionKittyEvent(
  event: TerminalOptionKeyboardEvent,
  context: {
    flags: number
    type: TerminalKittyCsiUEventType
    layoutCharacterForCode?: LayoutCharacterResolver
    associatedText?: string
  }
): string | null {
  const pc101Character = pc101CharacterForCode(event.code)
  const primaryCharacter =
    (event.code ? context.layoutCharacterForCode?.(event.code, false) : undefined) ?? pc101Character
  const primaryCodePoint = singleCodePoint(primaryCharacter)
  if (primaryCodePoint === undefined) {
    return null
  }
  const shiftedCharacter =
    event.shiftKey && event.code
      ? (context.layoutCharacterForCode?.(event.code, true) ??
        (!event.altKey ? event.key : undefined))
      : undefined
  return encodeTerminalKittyCsiU({
    flags: context.flags,
    type: context.type,
    primaryCodePoint,
    shiftedCodePoint: singleCodePoint(shiftedCharacter),
    baseCodePoint: singleCodePoint(pc101Character),
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    capsLock: event.capsLock ?? event.getModifierState?.('CapsLock') === true,
    numLock: event.numLock ?? event.getModifierState?.('NumLock') === true,
    associatedText: context.associatedText
  })
}
