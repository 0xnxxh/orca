import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import {
  createMobileNativeChatStreamingGate,
  deriveMobileNativeChatStreaming,
  type MobileNativeChatStreamingGate
} from './mobile-native-chat-streaming-gate'

function assistant(id: string, text: string): NativeChatMessage {
  return {
    id,
    role: 'assistant',
    blocks: [{ type: 'text', text }],
    timestamp: 0,
    source: 'transcript'
  }
}

/** Run a sequence of (folded, streamingText) ticks through one gate. */
function run(ticks: { folded: NativeChatMessage[]; text?: string }[]): {
  gate: MobileNativeChatStreamingGate
  results: (string | null)[]
} {
  let gate = createMobileNativeChatStreamingGate()
  const results: (string | null)[] = []
  for (const tick of ticks) {
    const step = deriveMobileNativeChatStreaming(gate, tick.folded, tick.text)
    gate = step.gate
    results.push(step.streaming)
  }
  return { gate, results }
}

describe('deriveMobileNativeChatStreaming', () => {
  it('shows a genuine reply that repeats the previous turn as a prefix', () => {
    const prior = [assistant('a1', 'The tests pass.')]
    const { results } = run([
      { folded: prior }, // idle tick anchors the pre-stream tail
      { folded: prior, text: 'The' },
      { folded: prior, text: 'The tests' },
      { folded: prior, text: 'The tests pass.' }
    ])
    expect(results).toEqual([null, 'The', 'The tests', 'The tests pass.'])
  })

  it('hides the bubble once the real turn lands leading with the streamed text', () => {
    const prior = [assistant('a1', 'earlier turn')]
    const landed = [...prior, assistant('a2', 'fresh answer with a tail')]
    const { results } = run([
      { folded: prior },
      { folded: prior, text: 'fresh answer' },
      { folded: landed, text: 'fresh answer' }
    ])
    expect(results).toEqual([null, 'fresh answer', null])
  })

  it('suppresses an identical repeated reply once its own turn lands', () => {
    const prior = [assistant('a1', 'Done.')]
    const landed = [...prior, assistant('a2', 'Done.')]
    const { results } = run([
      { folded: prior },
      { folded: prior, text: 'Done.' }, // repeated-prefix reply stays visible
      { folded: landed, text: 'Done.' } // its own turn landed — hide
    ])
    expect(results).toEqual([null, 'Done.', null])
  })

  it('re-anchors when a new reply part replaces the stream mid-turn', () => {
    const prior = [assistant('a1', 'context')]
    const partOneLanded = [...prior, assistant('a2', 'part one full text')]
    const { results } = run([
      { folded: prior },
      { folded: prior, text: 'part one' },
      { folded: partOneLanded, text: 'part one' }, // caught up — hide
      // Part two is not an extension of part one: new segment, new baseline.
      { folded: partOneLanded, text: 'part' }
    ])
    expect(results).toEqual([null, 'part one', null, 'part'])
  })

  it('falls back to suppress-on-prefix when mounted mid-stream', () => {
    // No idle tick ever observed: a duplicate bubble is worse than briefly
    // hiding a mount-coincident repeated reply.
    const landed = [assistant('a1', 'flushed part still streaming in status')]
    const { results } = run([{ folded: landed, text: 'flushed part' }])
    expect(results).toEqual([null])
  })

  it('is idempotent for a repeated tick', () => {
    const prior = [assistant('a1', 'The tests pass.')]
    const first = run([{ folded: prior }, { folded: prior, text: 'The tests' }])
    const again = deriveMobileNativeChatStreaming(first.gate, prior, 'The tests')
    expect(again.streaming).toBe('The tests')
    expect(again.gate).toEqual(first.gate)
  })

  it('returns null for empty or whitespace streaming text', () => {
    const prior = [assistant('a1', 'x')]
    expect(run([{ folded: prior, text: '   ' }]).results).toEqual([null])
    expect(run([{ folded: prior }]).results).toEqual([null])
  })
})
