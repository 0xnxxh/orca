import { afterEach, describe, expect, it, vi } from 'vitest'
import { AGENT_PROMPT_BRACKETED_PASTE_END } from '../../shared/agent-prompt-injection'
import { OrcaRuntimeService } from './orca-runtime'
import { makeStore } from './runtime-rpc-worktree-store-fixtures'

const WORKTREE_PATH = '/tmp/worktree-a'

vi.mock('../git/worktree', () => ({
  listWorktrees: vi.fn().mockResolvedValue([
    {
      path: '/tmp/worktree-a',
      head: 'abc',
      branch: 'feature/prompt-verification',
      isBare: false,
      isMainWorktree: false
    }
  ]),
  listWorktreesStrict: vi.fn().mockResolvedValue([
    {
      path: '/tmp/worktree-a',
      head: 'abc',
      branch: 'feature/prompt-verification',
      isBare: false,
      isMainWorktree: false
    }
  ])
}))

async function createPromptRuntime(
  onWrite: (runtime: OrcaRuntimeService, data: string, writeIndex: number) => void
): Promise<{ runtime: OrcaRuntimeService; handle: string; writes: string[] }> {
  const runtime = new OrcaRuntimeService(makeStore() as never)
  const writes: string[] = []
  runtime.setPtyController({
    spawn: vi.fn().mockResolvedValue({ id: 'pty-prompt' }),
    write: (_ptyId, data) => {
      writes.push(data)
      onWrite(runtime, data, writes.length)
      return true
    },
    kill: () => true,
    getForegroundProcess: async () => null
  })
  const terminal = await runtime.createTerminal(`path:${WORKTREE_PATH}`, {
    launchAgent: 'aider'
  })
  return { runtime, handle: terminal.handle, writes }
}

describe('agent prompt submission runtime', () => {
  afterEach(() => vi.useRealTimers())

  it('retries Enter once when the exact prompt remains at the cursor', async () => {
    vi.useFakeTimers()
    let enters = 0
    const { runtime, handle, writes } = await createPromptRuntime((runtime, data) => {
      if (data.includes(AGENT_PROMPT_BRACKETED_PASTE_END)) {
        runtime.onPtyData('pty-prompt', '\x1b[2J\x1b[H› review this', Date.now())
      } else if (data === '\r') {
        enters += 1
        if (enters === 2) {
          runtime.onPtyData('pty-prompt', '\x1b]0;Codex working\x07', Date.now())
        }
      }
    })
    const submission = runtime.sendTerminalAgentPrompt(handle, 'review this')

    await vi.runAllTimersAsync()

    await expect(submission).resolves.toMatchObject({ accepted: true })
    expect(writes.filter((data) => data === '\r')).toHaveLength(2)
  })

  it('does not retry when the prompt is visible only in history', async () => {
    vi.useFakeTimers()
    const { runtime, handle, writes } = await createPromptRuntime((runtime, data) => {
      if (data.includes(AGENT_PROMPT_BRACKETED_PASTE_END)) {
        runtime.onPtyData('pty-prompt', '\x1b[2J\x1b[Hreview this\r\n› ', Date.now())
      }
    })
    const submission = runtime.sendTerminalAgentPrompt(handle, 'review this')
    const rejected = expect(submission).rejects.toThrow('agent_prompt_stalled')

    await vi.runAllTimersAsync()

    await rejected
    expect(writes.filter((data) => data === '\r')).toHaveLength(1)
  })

  it('accepts output after the first Enter without retrying', async () => {
    vi.useFakeTimers()
    const { runtime, handle, writes } = await createPromptRuntime((runtime, data) => {
      if (data === '\r') {
        runtime.onPtyData('pty-prompt', 'agent started\r\n', Date.now())
      }
    })
    const submission = runtime.sendTerminalAgentPrompt(handle, 'review this')

    await vi.runAllTimersAsync()

    await expect(submission).resolves.toMatchObject({ accepted: true })
    expect(writes.filter((data) => data === '\r')).toHaveLength(1)
  })

  it('does not send Enter after a permission state appears', async () => {
    vi.useFakeTimers()
    const { runtime, handle, writes } = await createPromptRuntime((runtime, data) => {
      if (data.includes(AGENT_PROMPT_BRACKETED_PASTE_END)) {
        runtime.onPtyData('pty-prompt', '\x1b]0;Codex waiting for permission\x07', Date.now())
      }
    })
    const submission = runtime.sendTerminalAgentPrompt(handle, 'review this')
    const rejected = expect(submission).rejects.toThrow('agent_prompt_blocked')

    await vi.runAllTimersAsync()

    await rejected
    expect(writes).not.toContain('\r')
  })
})
