import { afterEach, describe, expect, it } from 'vitest'
import {
  _setLayoutMapForTests,
  _setLayoutSnapshotForTests,
  getLayoutBaseCharacterForCode,
  getLayoutCharacterForCode,
  normalizeLayoutBaseCharacter
} from './layout-base-character'

describe('normalizeLayoutBaseCharacter', () => {
  it('accepts a single printable codepoint, lowercased', () => {
    expect(normalizeLayoutBaseCharacter('p')).toBe('p')
    expect(normalizeLayoutBaseCharacter('P')).toBe('p')
    expect(normalizeLayoutBaseCharacter('ö')).toBe('ö')
    expect(normalizeLayoutBaseCharacter(';')).toBe(';')
  })

  it('rejects empty, named-key, multi-codepoint, and control values', () => {
    expect(normalizeLayoutBaseCharacter(undefined)).toBeUndefined()
    expect(normalizeLayoutBaseCharacter('')).toBeUndefined()
    expect(normalizeLayoutBaseCharacter('Dead')).toBeUndefined()
    expect(normalizeLayoutBaseCharacter('İ')).toBeUndefined()
    expect(normalizeLayoutBaseCharacter('\t')).toBeUndefined()
    expect(normalizeLayoutBaseCharacter(' ')).toBeUndefined()
  })
})

describe('getLayoutBaseCharacterForCode', () => {
  afterEach(() => {
    _setLayoutMapForTests(null)
    _setLayoutSnapshotForTests(null)
  })

  it('returns undefined without a cached map, and resolves through one', () => {
    expect(getLayoutBaseCharacterForCode('KeyP')).toBeUndefined()

    const azertyEntries = new Map([
      ['Semicolon', 'm'],
      ['KeyE', 'Dead']
    ])
    _setLayoutMapForTests({
      get: (code) => azertyEntries.get(code),
      size: azertyEntries.size
    })
    expect(getLayoutBaseCharacterForCode('Semicolon')).toBe('m')
    expect(getLayoutBaseCharacterForCode('KeyE')).toBeUndefined()
    expect(getLayoutBaseCharacterForCode('KeyZ')).toBeUndefined()
  })

  it('uses the native modifier layer for Shift and falls back safely', () => {
    _setLayoutMapForTests({ get: (code) => (code === 'Digit2' ? '2' : 'q'), size: 2 })
    _setLayoutSnapshotForTests({
      inputSourceId: 'com.apple.keylayout.Latvian',
      keyCharacters: {
        Digit2: { unmodified: '2', shifted: '@', optionUnmodified: '„' },
        KeyQ: { unmodified: 'q', shifted: 'Q', optionUnmodified: '@' }
      }
    })

    expect(getLayoutCharacterForCode('Digit2', false)).toBe('2')
    expect(getLayoutCharacterForCode('Digit2', true)).toBe('@')
    expect(getLayoutCharacterForCode('KeyQ', true)).toBe('Q')
    expect(getLayoutCharacterForCode('KeyQ', false, true)).toBe('@')

    _setLayoutSnapshotForTests(null)
    expect(getLayoutCharacterForCode('Digit2', true)).toBeUndefined()
    expect(getLayoutCharacterForCode('KeyQ', true)).toBe('Q')
    expect(getLayoutCharacterForCode('KeyQ', false, true)).toBeUndefined()
  })
})
