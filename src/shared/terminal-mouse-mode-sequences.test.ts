import { describe, expect, it } from 'vitest'
import {
  buildMouseModeRearmSequence,
  replayPayloadEndsInAlternateScreen,
  scanReplayedMouseModeRearm,
  TerminalMouseModeMirror
} from './terminal-mouse-mode-sequences'

describe('scanReplayedMouseModeRearm', () => {
  it('re-arms the protocol and encoding a payload left on', () => {
    expect(scanReplayedMouseModeRearm('\x1b[?1049hboot\x1b[?1002h\x1b[?1006hlive tui')).toBe(
      '\x1b[?1002h\x1b[?1006h'
    )
  })

  it('re-arms nothing when the payload turned mouse reporting back off', () => {
    expect(
      scanReplayedMouseModeRearm('\x1b[?1049h\x1b[?1002h\x1b[?1006h\x1b[?1002l\x1b[?1006l')
    ).toBe('')
  })

  it('treats RIS as clearing every mouse mode', () => {
    expect(scanReplayedMouseModeRearm('\x1b[?1003h\x1b[?1016h\x1bcfresh')).toBe('')
  })

  it('prefers the pixel encoding over SGR', () => {
    expect(scanReplayedMouseModeRearm('\x1b[?1049h\x1b[?1000h\x1b[?1016h')).toBe(
      '\x1b[?1000h\x1b[?1016h'
    )
  })

  it('does not re-arm mouse modes left behind in a normal-buffer snapshot', () => {
    expect(scanReplayedMouseModeRearm('\x1b[?1003h\x1b[?1006h')).toBe('')
  })

  it('honors the authoritative screen mode when the payload is only a replay tail', () => {
    expect(scanReplayedMouseModeRearm('\x1b[?1003h\x1b[?1006h', { isAlternateScreen: true })).toBe(
      '\x1b[?1003h\x1b[?1006h'
    )
    expect(
      scanReplayedMouseModeRearm('\x1b[?1049h\x1b[?1003h\x1b[?1006h', {
        isAlternateScreen: false
      })
    ).toBe('')
  })
})

describe('replayPayloadEndsInAlternateScreen', () => {
  it('tracks alternate-screen transitions in replay order', () => {
    expect(replayPayloadEndsInAlternateScreen('\x1b[?1049hframe\x1b[?1049lprompt')).toBe(false)
    expect(replayPayloadEndsInAlternateScreen('\x1b[?1049hframe')).toBe(true)
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
