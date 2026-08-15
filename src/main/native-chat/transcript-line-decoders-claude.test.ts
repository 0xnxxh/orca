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
