import { describe, expect, it } from 'vitest'
import { encodeTerminalKittyCsiU } from './terminal-kitty-csi-u-encoding'

const optionQ = {
  primaryCodePoint: 113,
  baseCodePoint: 113,
  shiftKey: false,
  altKey: true,
  ctrlKey: false,
  metaKey: false,
  associatedText: '@'
}

describe('terminal kitty CSI-u encoding', () => {
  it.each([
    [8, 'press', '\x1b[113;3u'],
    [10, 'repeat', '\x1b[113;3:2u'],
    [10, 'release', '\x1b[113;3:3u'],
    [24, 'press', '\x1b[113;3;64u'],
    [30, 'repeat', '\x1b[113;3:2;64u'],
    [30, 'release', '\x1b[113;3:3u']
  ] as const)('encodes flags %i %s', (flags, type, expected) => {
    expect(encodeTerminalKittyCsiU({ ...optionQ, flags, type })).toBe(expected)
  })

  it('encodes shifted and PC-101 alternates without redundant fields', () => {
    expect(
      encodeTerminalKittyCsiU({
        flags: 30,
        type: 'press',
        primaryCodePoint: 55,
        shiftedCodePoint: 47,
        baseCodePoint: 55,
        shiftKey: true,
        altKey: true,
        ctrlKey: false,
        metaKey: false,
        associatedText: '\\'
      })
    ).toBe('\x1b[55:47;4;92u')
    expect(
      encodeTerminalKittyCsiU({
        flags: 14,
        type: 'release',
        primaryCodePoint: 59,
        baseCodePoint: 113,
        shiftKey: false,
        altKey: true,
        ctrlKey: false,
        metaKey: false
      })
    ).toBe('\x1b[59::113;3:3u')
  })

  it('supports multi-codepoint associated text and suppresses it for Ctrl', () => {
    expect(
      encodeTerminalKittyCsiU({ ...optionQ, flags: 24, type: 'press', associatedText: 'á' })
    ).toBe('\x1b[113;3;97:769u')
    expect(encodeTerminalKittyCsiU({ ...optionQ, flags: 24, type: 'press', ctrlKey: true })).toBe(
      '\x1b[113;7u'
    )
  })

  it('omits control codepoints from associated text', () => {
    expect(
      encodeTerminalKittyCsiU({
        ...optionQ,
        flags: 24,
        type: 'press',
        primaryCodePoint: 97,
        altKey: false,
        associatedText: 'A\0B\x7fC\u0085D'
      })
    ).toBe('\x1b[97;;65:66:67:68u')
  })

  it('encodes lock modifier state', () => {
    expect(
      encodeTerminalKittyCsiU({
        ...optionQ,
        flags: 24,
        type: 'press',
        capsLock: true,
        numLock: true
      })
    ).toBe('\x1b[113;195;64u')
  })
})
