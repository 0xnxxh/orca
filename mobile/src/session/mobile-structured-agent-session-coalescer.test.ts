import { describe, expect, it, vi } from 'vitest'
import type { AgentSessionSubscribeEvent } from '../../../src/shared/agent-session-wire'
import { createMobileStructuredEventCoalescer } from './mobile-structured-agent-session-coalescer'

function batch(sequence: number, text: string): AgentSessionSubscribeEvent {
  return {
    type: 'batch',
    sessionId: 'session-a',
    batch: {
      cursor: { epoch: 'epoch-a', sequence },
      items: [
        {
          itemId: 'message',
          revision: sequence,
          sequence: 1,
          observedAt: 1,
          body: { kind: 'message', role: 'assistant', blocks: [{ type: 'text', text }] }
        }
      ],
      removedItemIds: [],
      submissions: []
    }
  }
}

describe('mobile structured event coalescer', () => {
  it('re-coalesces item snapshots for 48ms and keeps the newest revision', () => {
    vi.useFakeTimers()
    const seen: AgentSessionSubscribeEvent[] = []
    const coalescer = createMobileStructuredEventCoalescer((event) => seen.push(event))
    coalescer.push(batch(1, 'a'))
    coalescer.push(batch(2, 'ab'))
    vi.advanceTimersByTime(47)
    expect(seen).toEqual([])
    vi.advanceTimersByTime(1)
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ batch: { cursor: { sequence: 2 }, items: [{ revision: 2 }] } })
    vi.useRealTimers()
  })

  it('flushes pending text before a lifecycle row', () => {
    vi.useFakeTimers()
    const seen: AgentSessionSubscribeEvent[] = []
    const coalescer = createMobileStructuredEventCoalescer((event) => seen.push(event))
    coalescer.push(batch(1, 'a'))
    coalescer.push({
      type: 'batch',
      sessionId: 'session-a',
      batch: {
        cursor: { epoch: 'epoch-a', sequence: 2 },
        items: [
          {
            itemId: 'status',
            revision: 1,
            sequence: 2,
            observedAt: 2,
            body: { kind: 'status', text: 'done' }
          }
        ],
        removedItemIds: [],
        submissions: []
      }
    })
    expect(seen.map((event) => event.type)).toEqual(['batch', 'batch'])
    vi.useRealTimers()
  })

  it('bypasses coalescing for tool lifecycle snapshots', () => {
    vi.useFakeTimers()
    const seen: AgentSessionSubscribeEvent[] = []
    const coalescer = createMobileStructuredEventCoalescer((event) => seen.push(event))
    coalescer.push({
      type: 'batch',
      sessionId: 'session-a',
      batch: {
        cursor: { epoch: 'epoch-a', sequence: 1 },
        items: [
          {
            itemId: 'tool',
            revision: 1,
            sequence: 1,
            observedAt: 1,
            body: { kind: 'tool-call', name: 'shell', input: {}, state: 'running' }
          }
        ],
        removedItemIds: [],
        submissions: []
      }
    })

    expect(seen).toHaveLength(1)
    vi.useRealTimers()
  })
})
