import { isDeepStrictEqual } from 'node:util'
import { failTerminalSessionAuthority } from './terminal-session-authority-mutation'

/** Node-only canonical equality for persisted authority records. */
export function assertSemanticallyEqual(expected: unknown, actual: unknown, message: string): void {
  if (!isDeepStrictEqual(expected, actual)) {
    failTerminalSessionAuthority('record-corrupt', message)
  }
}
