import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AGENT_PROMPT_EFFECT_TIMEOUT_MS,
  type AgentPromptActivity,
  textBeforeCursorEndsWithPrompt,
  verifyAgentPromptSubmission
} from './agent-prompt-submission-verification'

function activity(overrides: Partial<AgentPromptActivity> = {}): AgentPromptActivity {
  return {
    generation: 1,
    lifecycleSequence: 4,
    outputSequence: 20,
    status: 'idle',
    ...overrides
  }
}

describe('agent prompt submission verification', () => {
  afterEach(() => vi.useRealTimers())

  it('accepts an observed lifecycle transition without retrying', async () => {
    vi.useFakeTimers()
    let current = activity()
    const retrySubmit = vi.fn()
    const verification = verifyAgentPromptSubmission({
      baseline: current,
      prompt: 'review this',
      readActivity: () => current,
      readTextBeforeCursor: vi.fn(),
      retrySubmit
    })

    current = activity({ lifecycleSequence: 5, status: 'working' })
    await vi.advanceTimersByTimeAsync(50)

    await expect(verification).resolves.toEqual({ retried: false })
    expect(retrySubmit).not.toHaveBeenCalled()
  })

  it('retries once when the full prompt remains immediately before the cursor', async () => {
    vi.useFakeTimers()
    let current = activity()
    const retrySubmit = vi.fn(async () => {
      current = activity({ lifecycleSequence: 5, outputSequence: 21, status: 'working' })
      return 'retried' as const
    })
    const verification = verifyAgentPromptSubmission({
      baseline: current,
      prompt: 'line one\nline two',
      readActivity: () => current,
      readTextBeforeCursor: async () => 'header\n› line one\nline two',
      retrySubmit
    })

    await vi.advanceTimersByTimeAsync(AGENT_PROMPT_EFFECT_TIMEOUT_MS + 50)

    await expect(verification).resolves.toEqual({ retried: true })
    expect(retrySubmit).toHaveBeenCalledOnce()
  })

  it('fails without retrying when the prompt is not at the cursor', async () => {
    vi.useFakeTimers()
    const current = activity()
    const retrySubmit = vi.fn()
    const verification = verifyAgentPromptSubmission({
      baseline: current,
      prompt: 'review this',
      readActivity: () => current,
      readTextBeforeCursor: async () => 'review this\n›',
      retrySubmit
    })
    const rejected = expect(verification).rejects.toThrow('agent_prompt_stalled')

    await vi.advanceTimersByTimeAsync(AGENT_PROMPT_EFFECT_TIMEOUT_MS)

    await rejected
    expect(retrySubmit).not.toHaveBeenCalled()
  })

  it('fails closed when only a large prompt suffix is visible', async () => {
    vi.useFakeTimers()
    const current = activity()
    const retrySubmit = vi.fn()
    const verification = verifyAgentPromptSubmission({
      baseline: current,
      prompt: `${'hidden '.repeat(200)}visible tail`,
      readActivity: () => current,
      readTextBeforeCursor: async () => 'visible tail',
      retrySubmit
    })
    const rejected = expect(verification).rejects.toThrow('agent_prompt_stalled')

    await vi.advanceTimersByTimeAsync(AGENT_PROMPT_EFFECT_TIMEOUT_MS)

    await rejected
    expect(retrySubmit).not.toHaveBeenCalled()
  })

  it('fails after one ineffective retry', async () => {
    vi.useFakeTimers()
    const current = activity()
    const retrySubmit = vi.fn().mockResolvedValue('retried')
    const verification = verifyAgentPromptSubmission({
      baseline: current,
      prompt: 'review this',
      readActivity: () => current,
      readTextBeforeCursor: async () => '› review this',
      retrySubmit
    })
    const rejected = expect(verification).rejects.toThrow('agent_prompt_stalled')

    await vi.advanceTimersByTimeAsync(AGENT_PROMPT_EFFECT_TIMEOUT_MS * 2)

    await rejected
    expect(retrySubmit).toHaveBeenCalledOnce()
  })

  it('retries after redraw-only output leaves the exact prompt at the cursor', async () => {
    vi.useFakeTimers()
    let current = activity()
    const retrySubmit = vi.fn(async () => {
      current = activity({ lifecycleSequence: 5, status: 'working' })
      return 'retried' as const
    })
    const verification = verifyAgentPromptSubmission({
      baseline: current,
      prompt: 'review this',
      readActivity: () => current,
      readTextBeforeCursor: async () => '› review this',
      retrySubmit
    })

    current = activity({ outputSequence: 21 })
    await vi.advanceTimersByTimeAsync(AGENT_PROMPT_EFFECT_TIMEOUT_MS + 50)

    await expect(verification).resolves.toEqual({ retried: true })
    expect(retrySubmit).toHaveBeenCalledOnce()
  })

  it('blocks a retry when permission appears after the first submit', async () => {
    vi.useFakeTimers()
    let current = activity()
    const retrySubmit = vi.fn()
    const verification = verifyAgentPromptSubmission({
      baseline: current,
      prompt: 'review this',
      readActivity: () => current,
      readTextBeforeCursor: async () => '› review this',
      retrySubmit
    })
    const rejected = expect(verification).rejects.toThrow('agent_prompt_blocked')

    current = activity({ status: 'permission' })
    await vi.advanceTimersByTimeAsync(50)

    await rejected
    expect(retrySubmit).not.toHaveBeenCalled()
  })

  it('reports permission reached after the retry as blocked', async () => {
    vi.useFakeTimers()
    let current = activity()
    const retrySubmit = vi.fn(async () => {
      current = activity({ lifecycleSequence: 5, status: 'permission' })
      return 'retried' as const
    })
    const verification = verifyAgentPromptSubmission({
      baseline: current,
      prompt: 'review this',
      readActivity: () => current,
      readTextBeforeCursor: async () => '› review this',
      retrySubmit
    })
    const rejected = expect(verification).rejects.toThrow('agent_prompt_blocked')

    await vi.advanceTimersByTimeAsync(AGENT_PROMPT_EFFECT_TIMEOUT_MS + 50)

    await rejected
    expect(retrySubmit).toHaveBeenCalledOnce()
  })

  it('cancels before retrying', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const current = activity()
    const retrySubmit = vi.fn()
    const verification = verifyAgentPromptSubmission({
      baseline: current,
      prompt: 'review this',
      readActivity: () => current,
      readTextBeforeCursor: async () => '› review this',
      retrySubmit,
      signal: controller.signal
    })

    controller.abort()

    await expect(verification).rejects.toThrow('request_aborted')
    expect(retrySubmit).not.toHaveBeenCalled()
  })

  it('does not retry prompts sent while an agent is already working', async () => {
    const current = activity({ status: 'working' })
    const retrySubmit = vi.fn()

    await expect(
      verifyAgentPromptSubmission({
        baseline: current,
        prompt: 'queue this',
        readActivity: () => current,
        readTextBeforeCursor: vi.fn(),
        retrySubmit
      })
    ).resolves.toEqual({ retried: false })
    expect(retrySubmit).not.toHaveBeenCalled()
  })

  it('rejects a replaced terminal generation', async () => {
    vi.useFakeTimers()
    const baseline = activity()
    const verification = verifyAgentPromptSubmission({
      baseline,
      prompt: 'review this',
      readActivity: () => activity({ generation: 2 }),
      readTextBeforeCursor: vi.fn(),
      retrySubmit: vi.fn()
    })

    await expect(verification).rejects.toThrow('terminal_handle_stale')
  })

  it('matches sanitized multiline text only at the cursor', () => {
    expect(
      textBeforeCursorEndsWithPrompt(
        'header\n› line one\nline two<ESC>x',
        'line one\nline two\x1bx'
      )
    ).toBe(true)
    expect(textBeforeCursorEndsWithPrompt('line one\nline two\n›', 'line one\nline two')).toBe(
      false
    )
  })

  it('preserves meaningful whitespace and hard cursor boundaries', () => {
    expect(textBeforeCursorEndsWithPrompt('› review this', 'review  this')).toBe(false)
    expect(textBeforeCursorEndsWithPrompt('› review this', 'review\tthis')).toBe(false)
    expect(textBeforeCursorEndsWithPrompt('› review this\n', 'review this')).toBe(false)
  })
})
