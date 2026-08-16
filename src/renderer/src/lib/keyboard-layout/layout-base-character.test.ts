import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  _refreshLayoutCharactersForTests,
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
    vi.unstubAllGlobals()
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
        Digit2: {
          unmodified: '2',
          shifted: '@',
          optionUnmodified: '„',
          optionShifted: '“'
        },
        KeyQ: { unmodified: 'q', shifted: 'Q', optionUnmodified: '@', optionShifted: 'Ω' }
      }
    })

    expect(getLayoutCharacterForCode('Digit2', false)).toBe('2')
    expect(getLayoutCharacterForCode('Digit2', true)).toBe('@')
    expect(getLayoutCharacterForCode('KeyQ', true)).toBe('Q')
    expect(getLayoutCharacterForCode('KeyQ', false, true)).toBe('@')
    expect(getLayoutCharacterForCode('KeyQ', true, true)).toBe('Ω')

    _setLayoutSnapshotForTests(null)
    expect(getLayoutCharacterForCode('Digit2', true)).toBeUndefined()
    expect(getLayoutCharacterForCode('KeyQ', true)).toBe('Q')
    expect(getLayoutCharacterForCode('KeyQ', false, true)).toBeUndefined()
  })

  it('keeps the last complete snapshot until an atomic refresh settles', async () => {
    _setLayoutSnapshotForTests({
      inputSourceId: 'old',
      keyCharacters: {
        Digit7: { unmodified: '7', shifted: '/', optionUnmodified: '{', optionShifted: '\\' }
      }
    })
    let resolveMap!: (map: { get: (code: string) => string | undefined; size: number }) => void
    let resolveSnapshot!: (snapshot: {
      inputSourceId: string
      keyCharacters: Record<
        string,
        {
          unmodified: string
          shifted: string
          optionUnmodified: string
          optionShifted: string
        }
      >
    }) => void
    const mapPromise = new Promise<{
      get: (code: string) => string | undefined
      size: number
    }>((resolve) => {
      resolveMap = resolve
    })
    const snapshotPromise = new Promise<Parameters<typeof resolveSnapshot>[0]>((resolve) => {
      resolveSnapshot = resolve
    })
    vi.stubGlobal('window', {
      navigator: { keyboard: { getLayoutMap: () => mapPromise } },
      api: { app: { getKeyboardLayoutSnapshot: () => snapshotPromise } }
    })

    const refresh = _refreshLayoutCharactersForTests()
    expect(getLayoutCharacterForCode('Digit7', true)).toBe('/')
    resolveMap({ get: () => '&', size: 1 })
    await Promise.resolve()
    expect(getLayoutCharacterForCode('Digit7', true)).toBe('/')
    resolveSnapshot({
      inputSourceId: 'new',
      keyCharacters: {
        Digit7: { unmodified: '7', shifted: '?', optionUnmodified: '[', optionShifted: ']' }
      }
    })
    await refresh
    expect(getLayoutCharacterForCode('Digit7', true)).toBe('?')
  })

  it('never combines a native snapshot with a separate layout-map fallback', () => {
    _setLayoutMapForTests({ get: () => 'q', size: 1 })
    _setLayoutSnapshotForTests({
      inputSourceId: 'partial',
      keyCharacters: {
        Digit7: { unmodified: '7', shifted: '/', optionUnmodified: '{', optionShifted: '\\' }
      }
    })

    expect(getLayoutBaseCharacterForCode('KeyQ')).toBeUndefined()
  })
})
