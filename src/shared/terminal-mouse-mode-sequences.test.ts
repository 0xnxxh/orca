import { describe, expect, it } from 'vitest'
import {
  buildMouseModeRearmSequence,
  scanReplayedMouseModeRearm,
  TerminalMouseModeMirror
} from './terminal-mouse-mode-sequences'

describe('scanReplayedMouseModeRearm', () => {
  it('re-arms the protocol and encoding a payload left on', () => {
    expect(scanReplayedMouseModeRearm('boot\x1b[?1002h\x1b[?1006hlive tui')).toBe(
      '\x1b[?1002h\x1b[?1006h'
    )
  })

  it('re-arms nothing when the payload turned mouse reporting back off', () => {
    expect(scanReplayedMouseModeRearm('\x1b[?1002h\x1b[?1006h\x1b[?1002l\x1b[?1006l')).toBe('')
  })

  it('treats RIS as clearing every mouse mode', () => {
    expect(scanReplayedMouseModeRearm('\x1b[?1003h\x1b[?1016h\x1bcfresh')).toBe('')
  })

  it('prefers the pixel encoding over SGR', () => {
    expect(scanReplayedMouseModeRearm('\x1b[?1000h\x1b[?1016h')).toBe('\x1b[?1000h\x1b[?1016h')
  })
})

describe('TerminalMouseModeMirror', () => {
  it('detects a DECSET split across two scan calls', () => {
    const mirror = new TerminalMouseModeMirror()
    mirror.scan('output\x1b[?10')
    mirror.scan('02h\x1b[?1006h')
    expect(mirror.mouseTrackingMode).toBe('drag')
    expect(mirror.sgrMouseMode).toBe(true)
  })
})

describe('buildMouseModeRearmSequence', () => {
  it('returns nothing when no protocol or encoding is armed', () => {
    expect(
      buildMouseModeRearmSequence({
        mouseTrackingMode: 'none',
        sgrMouseMode: false,
        sgrMousePixelsMode: false
      })
    ).toBe('')
  })

  it('keeps the encoding when reporting itself is off', () => {
    expect(
      buildMouseModeRearmSequence({
        mouseTrackingMode: 'none',
        sgrMouseMode: true,
        sgrMousePixelsMode: false
      })
    ).toBe('\x1b[?1006h')
  })
})
