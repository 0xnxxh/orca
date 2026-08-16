import {
  KITTY_REPORT_EVENT_TYPES,
  kittyReportsAllKeysAsEscapeCodes
} from '../../../../shared/terminal-kitty-keyboard-flags'
import { encodeTerminalOptionKittyEvent } from './terminal-kitty-csi-u-encoding'

/** The physical keydown that produced a commit, captured before the input event. */
export type ImeCommitKeyPress = {
  key: string
  code?: string
  shiftKey: boolean
  /** An auto-repeat keydown; the protocol distinguishes it from a fresh press. */
  repeat?: boolean
  capsLock?: boolean
  numLock?: boolean
}

/**
 * The matching physical release, read from the actual `keyup`.
 *
 * Why not reuse the press's fields: macOS lets Shift come up first, and the
 * browser then reports the printable keyup with the UNSHIFTED `key` and
 * `shiftKey: false`. Encoding that release from the press's shifted fields
 * would report a modifier the app no longer holds.
 */
export type ImeReleaseKeyEvent = {
  key: string
  code?: string
  shiftKey: boolean
  ctrlKey?: boolean
  altKey?: boolean
  metaKey?: boolean
  capsLock?: boolean
  numLock?: boolean
}

/**
 * Opaque proof that a delivered press/repeat owes a release report, carrying
 * the flags read at commit time. Only `encodeImeReleaseForKitty` interprets it:
 * the forwarder must never re-test event-type bits or rebuild CSI-u itself.
 */
export type ImeCommitReleaseObligation = { readonly flags: number }

export type ImeCommitKittyEncoding = {
  /** CSI-u press/repeat report, or null when the commit goes out as raw text. */
  report: string | null
  /** Non-null when the commit-time flags requested press/repeat/release events. */
  release: ImeCommitReleaseObligation | null
}

/**
 * A pane that negotiated bit 3 asked for every printable key as a CSI-u report,
 * so writing IME-committed text raw hands it the legacy byte stream it declined.
 * Re-encode the press that produced the commit instead.
 *
 * The gate is bit 3 ALONE for the press. "Kitty is active" and `flags !== 0` are
 * both wrong: a pane negotiating only disambiguation or event types still
 * expects printable keys as text, and encoding there would drop every
 * substituted character. Bit 1 (`report_event_types`) is independent — it makes
 * even a raw-text commit owe exactly one release report.
 *
 * The physical key remains the report identity; bit 4 carries the committed
 * text independently, including multi-codepoint commits.
 */
export function encodeImeCommitForKitty(
  press: ImeCommitKeyPress | null,
  kittyKeyboardFlags: number,
  context: {
    committedText: string
    layoutCharacterForCode?: (code: string, shifted: boolean) => string | undefined
  }
): ImeCommitKittyEncoding {
  if (!press) {
    return { report: null, release: null }
  }
  const report = !kittyReportsAllKeysAsEscapeCodes(kittyKeyboardFlags)
    ? null
    : encodeTerminalOptionKittyEvent(
        {
          ...press,
          altKey: false,
          ctrlKey: false,
          metaKey: false
        },
        {
          flags: kittyKeyboardFlags,
          type: press.repeat === true ? 'repeat' : 'press',
          layoutCharacterForCode: context.layoutCharacterForCode,
          associatedText: context.committedText
        }
      )
  return {
    report,
    release:
      (kittyKeyboardFlags & KITTY_REPORT_EVENT_TYPES) === 0 ? null : { flags: kittyKeyboardFlags }
  }
}

/**
 * Resolve a press's release obligation against the physical `keyup` that
 * actually settled it. Returns null when no release report is owed anymore.
 */
export function encodeImeReleaseForKitty(
  obligation: ImeCommitReleaseObligation,
  release: ImeReleaseKeyEvent,
  context: {
    /** The claimed press's identity, for keyups whose `key` an input source rewrote. */
    press?: { key: string; code?: string }
    /** The pane's flags at RELEASE time, deciding whether a release is still wanted. */
    currentKittyKeyboardFlags: number
    layoutCharacterForCode?: (code: string, shifted: boolean) => string | undefined
  }
): string | null {
  // Why the current-flags gate: the app can pop kitty mode between commit and
  // keyup (a TUI quitting on the pressed key). xterm suppresses releases the
  // moment `report_event_types` is gone — match it so the successor process
  // never receives CSI-u bytes it did not negotiate. The report itself still
  // encodes under the commit-time flags so the press/release pair stays
  // consistent.
  if ((context.currentKittyKeyboardFlags & KITTY_REPORT_EVENT_TYPES) === 0) {
    return null
  }
  // Why the key fallback: an input source can rewrite the keyup's `key`
  // ('Process' after a source switch mid-hold) while `code` still matches the
  // press; xterm's evaluate finds no encodable key there and would silently
  // drop the release, leaving the app with the key held forever. The keyup's
  // own single-char `key` wins (Shift-up-first correctly reports unshifted).
  const releaseKey =
    release.key.length === 1 || context.press === undefined
      ? release
      : { ...release, key: context.press.key, code: context.press.code ?? release.code }
  return encodeTerminalOptionKittyEvent(
    {
      ...releaseKey,
      altKey: release.altKey === true,
      ctrlKey: release.ctrlKey === true,
      metaKey: release.metaKey === true
    },
    {
      flags: obligation.flags,
      type: 'release',
      layoutCharacterForCode: context.layoutCharacterForCode
    }
  )
}
