import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { RelayDispatcher, type RelayClientSinkOptions } from './dispatcher'
import { publishAgentHookEnvelope } from './agent-hook-envelope-publication'
import { AGENT_HOOK_NOTIFICATION_METHOD } from '../shared/agent-hook-relay'
import type { AgentHookRelayEnvelope } from '../shared/agent-hook-relay'
import type { AgentSubagentSnapshot } from '../shared/agent-status-types'

type BoundedClient = {
  frames: Buffer[]
  closes: number
  options: RelayClientSinkOptions
  write: (data: Buffer) => boolean
}

function makeBoundedClient(highWaterMark: number): BoundedClient {
  const client: BoundedClient = {
    frames: [],
    closes: 0,
    write: (data: Buffer) => {
      client.frames.push(Buffer.from(data))
      return true
    },
    options: {
      writableHighWaterMark: () => highWaterMark,
      writableLength: () => 0,
      close: () => {
        client.closes++
      }
    }
  }
  return client
}

function decodePayload(frame: Buffer): Record<string, unknown> {
  const length = frame.readUInt32BE(9)
  return JSON.parse(frame.subarray(13, 13 + length).toString('utf-8'))
}

function decodeEnvelopes(client: BoundedClient): AgentHookRelayEnvelope[] {
  return client.frames
    .map((frame) => decodePayload(frame))
    .filter((msg) => msg.method === AGENT_HOOK_NOTIFICATION_METHOD)
    .map((msg) => msg.params as unknown as AgentHookRelayEnvelope)
}

function makeSubagents(count: number): AgentSubagentSnapshot[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `subagent-${index}-${'s'.repeat(40)}`,
    agentType: 'general-purpose',
    model: 'claude-opus',
    description: 'd'.repeat(200),
    state: 'working' as const,
    startedAt: 1_700_000_000_000 + index
  }))
}

function makeEnvelope(sizes: {
  lastAssistantMessage?: number
  interactivePrompt?: number
  subagents?: number
}): AgentHookRelayEnvelope {
  return {
    source: 'claude',
    paneKey: 'tab-1:4f1b0f4e-0000-4000-8000-000000000001',
    connectionId: null,
    worktreeId: 'worktree-1',
    payload: {
      state: 'working',
      prompt: 'p'.repeat(64),
      agentType: 'claude',
      model: 'claude-opus',
      toolName: 'Bash',
      toolInput: 'echo hi',
      ...(sizes.lastAssistantMessage !== undefined
        ? { lastAssistantMessage: 'a'.repeat(sizes.lastAssistantMessage) }
        : {}),
      ...(sizes.interactivePrompt !== undefined
        ? { interactivePrompt: 'q'.repeat(sizes.interactivePrompt) }
        : {}),
      ...(sizes.subagents !== undefined ? { subagents: makeSubagents(sizes.subagents) } : {})
    }
  }
}

describe('publishAgentHookEnvelope', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('publishes an in-capacity envelope untouched', () => {
    const primary = makeBoundedClient(65536)
    const dispatcher = new RelayDispatcher(primary.write, primary.options)
    try {
      const envelope = makeEnvelope({ lastAssistantMessage: 128, interactivePrompt: 64 })
      publishAgentHookEnvelope(dispatcher, envelope)

      const published = decodeEnvelopes(primary)
      expect(published).toHaveLength(1)
      expect(published[0]).toEqual(envelope)
      expect(primary.closes).toBe(0)
    } finally {
      dispatcher.dispose()
    }
  })

  it('sheds lastAssistantMessage first and stops as soon as the frame fits', () => {
    const primary = makeBoundedClient(16384)
    const dispatcher = new RelayDispatcher(primary.write, primary.options)
    try {
      // Only lastAssistantMessage pushes this past the 12288-byte producer cap.
      publishAgentHookEnvelope(
        dispatcher,
        makeEnvelope({ lastAssistantMessage: 20_000, interactivePrompt: 128, subagents: 2 })
      )

      const published = decodeEnvelopes(primary)
      expect(published).toHaveLength(1)
      expect(published[0].payload.lastAssistantMessage).toBeUndefined()
      expect(published[0].payload.interactivePrompt).toBe('q'.repeat(128))
      expect(published[0].payload.subagents).toHaveLength(2)
      expect(published[0].payload.state).toBe('working')
      expect(published[0].paneKey).toBe('tab-1:4f1b0f4e-0000-4000-8000-000000000001')
      expect(published[0].connectionId).toBeNull()
      expect(primary.closes).toBe(0)
    } finally {
      dispatcher.dispose()
    }
  })

  it('sheds interactivePrompt next when dropping the assistant message is not enough', () => {
    const primary = makeBoundedClient(16384)
    const dispatcher = new RelayDispatcher(primary.write, primary.options)
    try {
      publishAgentHookEnvelope(
        dispatcher,
        makeEnvelope({ lastAssistantMessage: 8_000, interactivePrompt: 13_000, subagents: 2 })
      )

      const published = decodeEnvelopes(primary)
      expect(published).toHaveLength(1)
      expect(published[0].payload.lastAssistantMessage).toBeUndefined()
      expect(published[0].payload.interactivePrompt).toBeUndefined()
      expect(published[0].payload.subagents).toHaveLength(2)
      expect(primary.closes).toBe(0)
    } finally {
      dispatcher.dispose()
    }
  })

  it('sheds subagents last and still delivers the status', () => {
    const primary = makeBoundedClient(16384)
    const dispatcher = new RelayDispatcher(primary.write, primary.options)
    try {
      publishAgentHookEnvelope(
        dispatcher,
        makeEnvelope({ lastAssistantMessage: 6_000, interactivePrompt: 6_000, subagents: 40 })
      )

      const published = decodeEnvelopes(primary)
      expect(published).toHaveLength(1)
      expect(published[0].payload.lastAssistantMessage).toBeUndefined()
      expect(published[0].payload.interactivePrompt).toBeUndefined()
      expect(published[0].payload.subagents).toBeUndefined()
      expect(published[0].payload.state).toBe('working')
      expect(primary.closes).toBe(0)
    } finally {
      dispatcher.dispose()
    }
  })

  it('skips absent fields instead of consuming a shed step on them', () => {
    const primary = makeBoundedClient(16384)
    const dispatcher = new RelayDispatcher(primary.write, primary.options)
    try {
      // No lastAssistantMessage at all: the ladder must move on to interactivePrompt.
      publishAgentHookEnvelope(dispatcher, makeEnvelope({ interactivePrompt: 20_000 }))

      const published = decodeEnvelopes(primary)
      expect(published).toHaveLength(1)
      expect(published[0].payload.interactivePrompt).toBeUndefined()
      expect(primary.closes).toBe(0)
    } finally {
      dispatcher.dispose()
    }
  })

  it('publishes without closing the client when even the fully shed envelope is oversized', () => {
    const primary = makeBoundedClient(16384)
    const dispatcher = new RelayDispatcher(primary.write, primary.options)
    try {
      const envelope = makeEnvelope({})
      envelope.payload.prompt = 'p'.repeat(40_000)
      publishAgentHookEnvelope(dispatcher, envelope)

      expect(decodeEnvelopes(primary)).toHaveLength(0)
      expect(primary.closes).toBe(0)

      // The sink still accepts the next in-capacity frame.
      publishAgentHookEnvelope(dispatcher, makeEnvelope({}))
      expect(decodeEnvelopes(primary)).toHaveLength(1)
    } finally {
      dispatcher.dispose()
    }
  })

  it('does not mutate the caller envelope, so the hook-server replay cache stays intact', () => {
    const primary = makeBoundedClient(16384)
    const dispatcher = new RelayDispatcher(primary.write, primary.options)
    try {
      const envelope = makeEnvelope({
        lastAssistantMessage: 6_000,
        interactivePrompt: 6_000,
        subagents: 40
      })
      const before = structuredClone(envelope)

      publishAgentHookEnvelope(dispatcher, envelope)

      expect(envelope).toEqual(before)
      expect(envelope.payload.lastAssistantMessage).toBe('a'.repeat(6_000))
      expect(envelope.payload.subagents).toHaveLength(40)
    } finally {
      dispatcher.dispose()
    }
  })

  it('sheds to the smallest attached sink so a replay reaches every client', () => {
    const primary = makeBoundedClient(65536)
    const dispatcher = new RelayDispatcher(primary.write, primary.options)
    const secondary = makeBoundedClient(16384)
    try {
      dispatcher.attachClient(secondary.write, secondary.options)
      publishAgentHookEnvelope(dispatcher, makeEnvelope({ lastAssistantMessage: 20_000 }))

      for (const client of [primary, secondary]) {
        const published = decodeEnvelopes(client)
        expect(published).toHaveLength(1)
        expect(published[0].payload.lastAssistantMessage).toBeUndefined()
        expect(client.closes).toBe(0)
      }
    } finally {
      dispatcher.dispose()
    }
  })
})
