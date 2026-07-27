import { afterEach, describe, expect, it, vi } from 'vitest'
import { getTerminalUrlOpenHint } from './terminal-link-open-hints'

function stubPlatform(isMac: boolean): void {
  vi.stubGlobal('navigator', { userAgent: isMac ? 'Mac OS X' : 'Windows NT 10.0' })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getTerminalUrlOpenHint', () => {
  it('keeps the system-browser wording by default', () => {
    stubPlatform(true)
    expect(getTerminalUrlOpenHint()).toBe('⌘+click to open or ⇧⌘+click for system browser')
  })

  it('keeps the system-browser wording when inverting is off', () => {
    stubPlatform(true)
    expect(getTerminalUrlOpenHint({ openLinksInApp: false, modifierInverts: false })).toContain(
      'for system browser'
    )
  })

  // Why: with links already opening in Orca, inverting still lands on the system
  // browser, so the hint must not promise Orca.
  it('keeps the system-browser wording when inverting but links open in Orca', () => {
    stubPlatform(true)
    expect(getTerminalUrlOpenHint({ openLinksInApp: true, modifierInverts: true })).toContain(
      'for system browser'
    )
  })

  it('names Orca when inverting and links open externally', () => {
    stubPlatform(true)
    expect(getTerminalUrlOpenHint({ openLinksInApp: false, modifierInverts: true })).toBe(
      '⌘+click to open or ⇧⌘+click to open in Orca'
    )
  })

  it('uses the Ctrl chord off macOS', () => {
    stubPlatform(false)
    expect(getTerminalUrlOpenHint({ openLinksInApp: false, modifierInverts: true })).toBe(
      'Ctrl+click to open or Shift+Ctrl+click to open in Orca'
    )
  })
})
