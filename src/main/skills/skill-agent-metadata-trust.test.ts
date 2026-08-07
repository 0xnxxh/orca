import { beforeEach, describe, expect, it, vi } from 'vitest'

const parseMock = vi.hoisted(() => vi.fn())

vi.mock('yaml', () => ({ parse: parseMock }))

import {
  isBehaviorInertAgentMetadata,
  MAX_BEHAVIOR_INERT_AGENT_METADATA_BYTES
} from './skill-agent-metadata-trust'

describe('skill agent metadata trust', () => {
  beforeEach(() => {
    parseMock.mockReset()
    parseMock.mockReturnValue({ interface: { display_name: 'Orca' } })
  })

  it.each([
    ['another path', 'agents/other.yaml', false, 1],
    ['executable metadata', 'agents/openai.yaml', true, 1],
    ['oversized metadata', 'agents/openai.yaml', false, MAX_BEHAVIOR_INERT_AGENT_METADATA_BYTES + 1]
  ])('rejects %s before YAML parsing', (_label, path, executable, size) => {
    expect(isBehaviorInertAgentMetadata(path, Buffer.alloc(size, 0x20), executable)).toBe(false)
    expect(parseMock).not.toHaveBeenCalled()
  })

  it('admits the byte boundary with expansion disabled', () => {
    expect(
      isBehaviorInertAgentMetadata(
        'agents/openai.yaml',
        Buffer.alloc(MAX_BEHAVIOR_INERT_AGENT_METADATA_BYTES, 0x20),
        false
      )
    ).toBe(true)
    expect(parseMock).toHaveBeenCalledWith(expect.any(String), { maxAliasCount: 0 })
  })
})
