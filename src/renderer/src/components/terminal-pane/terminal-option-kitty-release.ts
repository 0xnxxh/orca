import { KITTY_REPORT_EVENT_TYPES } from '../../../../shared/terminal-kitty-keyboard-flags'
import { encodeTerminalOptionKittyEvent } from './terminal-kitty-csi-u-encoding'

export type TerminalOptionKittyRelease = { flags: number }

type OptionKeyboardEvent = {
  key: string
  code?: string
  shiftKey: boolean
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  repeat?: boolean
}

type PendingRelease = {
  sendInput: (data: string) => void
  getCurrentFlags: () => number
  layoutCharacterForCode?: (code: string, shifted: boolean) => string | undefined
}

function keyIdentity(event: Pick<OptionKeyboardEvent, 'key' | 'code'>): string {
  return event.code || event.key
}

export function createTerminalOptionKittyReleaseTracker(): {
  arm: (
    event: OptionKeyboardEvent,
    release: TerminalOptionKittyRelease,
    sendInput: (data: string) => void,
    getCurrentFlags: () => number,
    layoutCharacterForCode?: (code: string, shifted: boolean) => string | undefined
  ) => void
  settle: (event: OptionKeyboardEvent) => boolean
  clear: () => void
} {
  const pending = new Map<string, PendingRelease>()
  return {
    arm: (event, release, sendInput, getCurrentFlags, layoutCharacterForCode) => {
      if ((release.flags & KITTY_REPORT_EVENT_TYPES) === 0) {
        return
      }
      const id = keyIdentity(event)
      if (event.repeat !== true || !pending.has(id)) {
        pending.set(id, { sendInput, getCurrentFlags, layoutCharacterForCode })
      }
    },
    settle: (event) => {
      const id = keyIdentity(event)
      const record = pending.get(id)
      if (!record) {
        return false
      }
      pending.delete(id)
      const flags = record.getCurrentFlags()
      if ((flags & KITTY_REPORT_EVENT_TYPES) !== 0) {
        const data = encodeTerminalOptionKittyEvent(event, {
          flags,
          type: 'release',
          layoutCharacterForCode: record.layoutCharacterForCode
        })
        if (data) {
          record.sendInput(data)
        }
      }
      return true
    },
    clear: () => pending.clear()
  }
}
