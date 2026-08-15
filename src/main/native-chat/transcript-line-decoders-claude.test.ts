import { describe, expect, it } from 'vitest'
import { decodeClaudeTranscriptLine } from './transcript-line-decoders-claude'

function decodeMeta(content: unknown) {
  return decodeClaudeTranscriptLine(
    JSON.stringify({
      type: 'user',
      uuid: 'meta-row',
      isMeta: true,
      message: { role: 'user', content }
    }),
    'fallback'
  )
}

function decodeLegacy(content: unknown, isMeta: boolean) {
  return decodeClaudeTranscriptLine(
    JSON.stringify({
      type: 'user',
      uuid: isMeta ? 'meta-row' : 'literal-row',
      ...(isMeta ? { isMeta: true } : {}),
      message: { role: 'user', content }
    }),
    'fallback',
    false
  )
}

describe('decodeClaudeTranscriptLine', () => {
  it('retains an exact image-source meta record for downstream folding', () => {
    expect(decodeMeta('[Image: source: /tmp/a.png]')).toMatchObject({
      id: 'meta-row',
      role: 'user',
      blocks: [{ type: 'text', text: '[Image: source: /tmp/a.png]' }]
    })
  })

  it('retains every source block in one structural multi-image meta record', () => {
    expect(
      decodeMeta([
        { type: 'text', text: '[Image: source: /tmp/a.png]' },
        { type: 'text', text: '[Image: source: C:\\Users\\me\\b.png]' },
        { type: 'text', text: '[Image: source: /ssh/workspace/c.png]' }
      ])
    ).toMatchObject({
      blocks: [
        { type: 'text', text: '[Image: source: /tmp/a.png]' },
        { type: 'text', text: '[Image: source: C:\\Users\\me\\b.png]' },
        { type: 'text', text: '[Image: source: /ssh/workspace/c.png]' }
      ]
    })
  })

  it('reproduces the released projection without dropping literal user text', () => {
    const marker = '[Image: source: /tmp/a.png]'
    const sources = [marker, '[Image: source: C:\\Users\\me\\b.png]']

    expect(decodeLegacy(marker, true)).toBeNull()
    expect(decodeLegacy(sources, true)).toBeNull()
    expect(decodeLegacy(marker, false)).toMatchObject({
      id: 'literal-row',
      blocks: [{ type: 'text', text: marker }]
    })
  })

  it('continues to suppress unrelated and mixed meta text', () => {
    expect(decodeMeta('<system-reminder>hidden</system-reminder>')).toBeNull()
    expect(
      decodeMeta([
        { type: 'text', text: '[Image: source: /tmp/a.png]' },
        { type: 'text', text: '<system-reminder>hidden</system-reminder>' }
      ])
    ).toBeNull()
  })

  it.each(['isMeta', 'isSynthetic', 'isCompactSummary'])('suppresses %s noise', (flag) => {
    expect(
      decodeClaudeTranscriptLine(
        JSON.stringify({
          type: 'user',
          uuid: flag,
          [flag]: true,
          message: { role: 'user', content: [{ type: 'text', text: 'hidden machinery' }] }
        }),
        'fallback'
      )
    ).toBeNull()
  })
})
