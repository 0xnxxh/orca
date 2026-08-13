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

    expect(item).not.toBeNull()
    if (!item) {
      throw new Error('expected substantive provider frame')
    }
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

    expect(item?.body.providerFrame?.payload.head).toContain('unserializable payload')
  })

  it('routes provider lifecycle, startup, and status frames away from the timeline', () => {
    expect(unhandledProviderFrameJournalItem('codex', 'notification:thread/started', {})).toBeNull()
    expect(
      unhandledProviderFrameJournalItem('codex', 'notification:mcpServer/startupStatus/updated', {})
    ).toBeNull()
    expect(
      unhandledProviderFrameJournalItem('codex', 'notification:remoteControl/status/changed', {})
    ).toBeNull()
    expect(
      unhandledProviderFrameJournalItem('codex', 'notification:thread/tokenUsage/updated', {})
    ).toBeNull()
    expect(
      unhandledProviderFrameJournalItem('codex', 'notification:thread/goal/cleared', {})
    ).toBeNull()
    expect(unhandledProviderFrameJournalItem('claude', 'message:system:init', {})).toBeNull()
    expect(unhandledProviderFrameJournalItem('claude', 'message:result', {})).toBeNull()
  })

  it('keeps unknown substantive frames visible for both providers', () => {
    expect(
      unhandledProviderFrameJournalItem('codex', 'notification:future/event', {})
    ).not.toBeNull()
    expect(unhandledProviderFrameJournalItem('claude', 'message:future/event', {})).not.toBeNull()
  })
})
