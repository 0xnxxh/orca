import { createElement } from 'react'
import TestRenderer from 'react-test-renderer'
import { describe, expect, it } from 'vitest'
import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { useMobileNativeChatPrompts } from './use-mobile-native-chat-prompts'

const APPROVAL = JSON.stringify({
  approval: { tool: 'Bash', summary: 'pnpm build > build.log 2>&1' }
})

function permissionFor(status: Partial<AgentStatusEntry> | null): unknown {
  let captured: unknown
  function Probe(): null {
    captured = useMobileNativeChatPrompts({
      enabled: true,
      status: status as AgentStatusEntry | null,
      messages: [],
      transcriptLoading: false
    }).permission
    return null
  }
  TestRenderer.act(() => {
    TestRenderer.create(createElement(Probe))
  })
  return captured
}

describe('useMobileNativeChatPrompts approval-envelope state gate', () => {
  it('renders no approval card while the agent is working', () => {
    expect(permissionFor({ state: 'working', interactivePrompt: APPROVAL })).toBeNull()
  })

  it('renders no approval card after the turn is done', () => {
    expect(permissionFor({ state: 'done', interactivePrompt: APPROVAL })).toBeNull()
  })

  it('renders no approval card without a status', () => {
    expect(permissionFor(null)).toBeNull()
  })

  it('renders the approval card while the agent is waiting', () => {
    expect(permissionFor({ state: 'waiting', interactivePrompt: APPROVAL })).toMatchObject({
      title: 'Allow Bash?',
      detail: 'pnpm build > build.log 2>&1'
    })
  })

  it('renders the approval card while the agent is blocked', () => {
    expect(permissionFor({ state: 'blocked', interactivePrompt: APPROVAL })).toMatchObject({
      title: 'Allow Bash?'
    })
  })

  it('prefers the heuristic numbered menu over the envelope while paused', () => {
    const permission = permissionFor({
      state: 'waiting',
      interactivePrompt: APPROVAL,
      lastAssistantMessage: 'Allow this Bash command?\n1. Yes\n2. No'
    }) as { options: Array<{ label: string }> } | null
    expect(permission).toMatchObject({ title: 'Permission requested' })
    expect(permission?.options.map((o) => o.label)).toEqual(['Yes', 'No'])
  })
})

const ASK_INPUT = {
  questions: [
    { question: 'Pick one', header: 'Choice', multiSelect: false, options: [{ label: 'A' }] }
  ]
}

const PENDING_ASK_MESSAGES: NativeChatMessage[] = [
  {
    id: 'm1',
    role: 'assistant',
    blocks: [{ type: 'tool-call', name: 'AskUserQuestion', input: ASK_INPUT }],
    timestamp: 0,
    source: 'transcript'
  }
]

function askFor(args: {
  status: Partial<AgentStatusEntry> | null
  transcriptLoading: boolean
}): unknown {
  let captured: unknown
  function Probe(): null {
    captured = useMobileNativeChatPrompts({
      enabled: true,
      status: args.status as AgentStatusEntry | null,
      messages: PENDING_ASK_MESSAGES,
      transcriptLoading: args.transcriptLoading
    }).ask
    return null
  }
  TestRenderer.act(() => {
    TestRenderer.create(createElement(Probe))
  })
  return captured
}

describe('useMobileNativeChatPrompts held-transcript ask gate', () => {
  it('renders the transcript ask once the read has settled', () => {
    expect(askFor({ status: { state: 'done' }, transcriptLoading: false })).toMatchObject({
      questions: [{ question: 'Pick one' }]
    })
  })

  it('withholds the transcript ask while the read is unsettled', () => {
    // The reconnect cache keeps this list rendered across a client swap, so the
    // card would otherwise resurrect after the ask was answered on the terminal
    // — and it stays tappable, writing stray keystrokes to the agent's TUI.
    expect(askFor({ status: { state: 'done' }, transcriptLoading: true })).toBeNull()
  })

  it('still renders a live status ask while the read is unsettled', () => {
    const ask = askFor({
      status: {
        state: 'waiting',
        toolName: 'AskUserQuestion',
        interactivePrompt: JSON.stringify(ASK_INPUT)
      },
      transcriptLoading: true
    })
    expect(ask).toMatchObject({ questions: [{ question: 'Pick one' }] })
  })
})
