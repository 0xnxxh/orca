import { describe, expect, it } from 'vitest'

import { normalizeTerminalTextInput } from './terminal-text-input-normalization'

describe('normalizeTerminalTextInput', () => {
  it('converts iOS smart dash replacements back to terminal hyphens', () => {
    expect(normalizeTerminalTextInput('git checkout – file')).toBe('git checkout -- file')
    expect(normalizeTerminalTextInput('git checkout — file')).toBe('git checkout -- file')
  })

  it('keeps ASCII hyphens unchanged', () => {
    expect(normalizeTerminalTextInput('git checkout -- file')).toBe('git checkout -- file')
  })

  it('recomposes decomposed Hangul that iOS hands back as conjoining jamo', () => {
    const decomposed = '안녕하세요'.normalize('NFD')
    expect(Array.from(decomposed)).toHaveLength(12)

    const normalized = normalizeTerminalTextInput(decomposed)

    expect(normalized).toBe('안녕하세요')
    expect(Array.from(normalized)).toHaveLength(5)
  })

  it('recomposes decomposed Latin diacritics and stays idempotent on composed text', () => {
    expect(normalizeTerminalTextInput('tiếng'.normalize('NFD'))).toBe('tiếng')
    expect(normalizeTerminalTextInput('안녕하세요')).toBe('안녕하세요')
    expect(normalizeTerminalTextInput(normalizeTerminalTextInput('café'.normalize('NFD')))).toBe(
      'café'
    )
  })

  it('leaves compatibility forms alone so NFC never becomes a lossy NFKC fold', () => {
    // NFKC would fold these into different characters and silently rewrite a command.
    expect(normalizeTerminalTextInput('ㅇㅏㄴ')).toBe('ㅇㅏㄴ')
    expect(normalizeTerminalTextInput('ｇｉｔ')).toBe('ｇｉｔ')
    expect(normalizeTerminalTextInput('①')).toBe('①')
  })
})
