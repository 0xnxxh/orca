import type { OptionKeyLocationState } from '../../lib/keyboard-layout/option-key-location-state'
import {
  KITTY_REPORT_EVENT_TYPES,
  kittyReportsAllKeysAsEscapeCodes
} from '../../../../shared/terminal-kitty-keyboard-flags'
import {
  encodeTerminalOptionKittyEvent,
  pc101CharacterForCode
} from './terminal-kitty-csi-u-encoding'
import type { TerminalOptionKittyRelease } from './terminal-option-kitty-release'

export type MacOptionAsAlt = 'true' | 'false' | 'left' | 'right'

type TerminalOptionShortcutEvent = {
  key: string
  code?: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  repeat?: boolean
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

function createRelease(flags: number): TerminalOptionKittyRelease | undefined {
  return (flags & KITTY_REPORT_EVENT_TYPES) === 0 ? undefined : { flags }
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

  const flags = context.getKittyKeyboardFlags()
  if (event.key !== 'Dead' && flags > 0) {
    const baseCharacter =
      (event.code ? context.layoutCharacterForCode?.(event.code, false) : undefined) ??
      pc101CharacterForCode(event.code)
    if (baseCharacter) {
      const characterWithoutOption = event.code
        ? (context.layoutCharacterForCode?.(event.code, event.shiftKey) ??
          (!event.shiftKey ? baseCharacter : undefined))
        : undefined
      if (
        !kittyReportsAllKeysAsEscapeCodes(flags) &&
        canSendComposedText &&
        characterWithoutOption &&
        isLayoutComposedAsciiCharacter(event.key, characterWithoutOption)
      ) {
        return { type: 'sendInput', data: event.key, optionKittyRelease: createRelease(flags) }
      }

      const data = encodeTerminalOptionKittyEvent(event, {
        flags,
        type: event.repeat === true ? 'repeat' : 'press',
        layoutCharacterForCode: context.layoutCharacterForCode,
        associatedText:
          kittyReportsAllKeysAsEscapeCodes(flags) && canSendComposedText ? event.key : undefined
      })
      if (data) {
        return { type: 'sendInput', data, optionKittyRelease: createRelease(flags) }
      }
    }
  }

  if (!event.shiftKey) {
    if (shouldActAsMeta) {
      const character = pc101CharacterForCode(event.code)
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
