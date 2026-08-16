import { KITTY_REPORT_EVENT_TYPES } from './terminal-kitty-keyboard-flags'

export type TerminalOptionKittyRelease = {
  flags: number
  primaryCodePoint: number
  shiftedCodePoint?: number
  baseCodePoint?: number
  modifiers: number
}

type KeyIdentityEvent = {
  key: string
  code?: string
}

type PendingRelease = {
  release: TerminalOptionKittyRelease
  sendInput: (data: string) => void
  getCurrentFlags: () => number
}

function keyIdentity(event: KeyIdentityEvent): string {
  return event.code || event.key
}

export function encodeTerminalOptionKittyRelease(
  release: TerminalOptionKittyRelease,
  currentFlags: number
): string | null {
  if ((currentFlags & KITTY_REPORT_EVENT_TYPES) === 0) {
    return null
  }
  const keyCodes = [
    String(release.primaryCodePoint),
    release.shiftedCodePoint === undefined ? '' : String(release.shiftedCodePoint),
    release.baseCodePoint === undefined ? '' : String(release.baseCodePoint)
  ]
  while (keyCodes.at(-1) === '') {
    keyCodes.pop()
  }
  return `\x1b[${keyCodes.join(':')};${release.modifiers}:3u`
}

export function createTerminalOptionKittyReleaseTracker(): {
  arm: (
    event: KeyIdentityEvent,
    release: TerminalOptionKittyRelease,
    sendInput: (data: string) => void,
    getCurrentFlags: () => number
  ) => void
  settle: (event: KeyIdentityEvent) => boolean
  clear: () => void
} {
  const pending = new Map<string, PendingRelease>()
  return {
    arm: (event, release, sendInput, getCurrentFlags) => {
      pending.set(keyIdentity(event), { release, sendInput, getCurrentFlags })
    },
    settle: (event) => {
      const id = keyIdentity(event)
      const record = pending.get(id)
      if (!record) {
        return false
      }
      pending.delete(id)
      const data = encodeTerminalOptionKittyRelease(record.release, record.getCurrentFlags())
      if (data) {
        record.sendInput(data)
      }
      return true
    },
    clear: () => pending.clear()
  }
}
