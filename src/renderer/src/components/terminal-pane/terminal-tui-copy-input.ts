import { KittyKeyboard } from '@xterm/xterm/src/common/input/KittyKeyboard'

const KITTY_EVENT_TYPE_PRESS = 1
const kittyKeyboardEncoder = new KittyKeyboard()

/** Encodes the platform copy chord for a TUI-owned selection. */
export function encodeTerminalTuiCopyInput(
  platform: NodeJS.Platform,
  kittyKeyboardFlags: number
): string | null {
  if (kittyKeyboardFlags <= 0) {
    return null
  }
  const isMac = platform === 'darwin'
  const encoded = kittyKeyboardEncoder.evaluate(
    {
      type: 'keydown',
      key: 'c',
      code: 'KeyC',
      keyCode: 67,
      shiftKey: !isMac,
      altKey: false,
      ctrlKey: !isMac,
      metaKey: isMac
    },
    kittyKeyboardFlags,
    KITTY_EVENT_TYPE_PRESS
  )
  return encoded.key ?? null
}
