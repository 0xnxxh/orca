export const KITTY_REPORT_EVENT_TYPES = 0b0010
export const KITTY_REPORT_ALTERNATE_KEYS = 0b0100
export const KITTY_REPORT_ALL_KEYS_AS_ESCAPE_CODES = 0b1000

export function kittyReportsAllKeysAsEscapeCodes(flags: number): boolean {
  return (flags & KITTY_REPORT_ALL_KEYS_AS_ESCAPE_CODES) !== 0
}
