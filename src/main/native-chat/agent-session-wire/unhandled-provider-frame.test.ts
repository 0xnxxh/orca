import { describe, expect, it } from 'vitest'
import { unhandledProviderFrameJournalItem } from './unhandled-provider-frame'

describe('unhandled provider frame journal fallback', () => {
  it('keeps a compact label and bounds the expandable payload without dropping it', () => {
    const item = unhandledProviderFrameJournalItem(
      'future-provider',
      'notification:new/event',
      { body: 'abcdefghij' },
      {
        inlineHeadBytes: 8,
        maxSessionBytes: 1024,
        maxAppendsPerWindow: 10,
        appendWindowMs: 1000
      }
    )

    expect(item.body).toMatchObject({
      kind: 'status',
      text: 'future-provider · notification:new/event',
      providerFrame: {
        provider: 'future-provider',
        kind: 'notification:new/event',
        payload: { byteLength: 21, truncated: true }
      }
    })
    expect(
      Buffer.byteLength(item.body.providerFrame?.payload.head ?? '', 'utf8')
    ).toBeLessThanOrEqual(8)
    expect(item.blobs).toEqual([
      {
        digest: item.body.providerFrame?.payload.digest,
        payload: '{"body":"abcdefghij"}'
      }
    ])
  })

  it('turns an unserializable payload into an explicit visible value', () => {
    const cyclic: { self?: unknown } = {}
    cyclic.self = cyclic

    const item = unhandledProviderFrameJournalItem('codex', 'frame', cyclic)

    expect(item.body.providerFrame?.payload.head).toContain('unserializable payload')
  })
})
