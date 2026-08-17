import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AGENT_PROMPT_BRACKETED_PASTE_END,
  AGENT_PROMPT_SUBMIT_DELAY_MS
} from '../../shared/agent-prompt-injection'
import { AGENT_PROMPT_EFFECT_TIMEOUT_MS } from './agent-prompt-submission-verification'
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

  it('does not paste into an existing permission prompt', async () => {
    vi.useFakeTimers()
    const { runtime, handle, writes } = await createPromptRuntime(() => undefined)
    runtime.onPtyData('pty-prompt', '\x1b]0;Codex waiting for permission\x07', Date.now())

    await expect(runtime.sendTerminalAgentPrompt(handle, 'review this')).rejects.toThrow(
      'agent_prompt_blocked'
    )
    expect(writes).toEqual([])
  })

  it('prefers a later permission title over an earlier explicit idle status', async () => {
    vi.useFakeTimers()
    const { runtime, handle, writes } = await createPromptRuntime(() => undefined)
    runtime.onPtyData(
      'pty-prompt',
      '\x1b]9999;{"state":"done","agentType":"aider"}\x07',
      Date.now()
    )
    runtime.onPtyData('pty-prompt', '\x1b]0;Codex waiting for permission\x07', Date.now())

    await expect(runtime.sendTerminalAgentPrompt(handle, 'review this')).rejects.toThrow(
      'agent_prompt_blocked'
    )
    expect(writes).toEqual([])
  })

  it('does not retry from a composer snapshot older than observed output', async () => {
    vi.useFakeTimers()
    let resolveSnapshot!: (snapshot: {
      data: string
      cols: number
      rows: number
      seq: number
      source: 'headless'
    }) => void
    let snapshotSequence = 0
    const runtime = new OrcaRuntimeService(makeStore() as never)
    const writes: string[] = []
    const serializeProviderBuffer = vi.fn(
      () =>
        new Promise<{
          data: string
          cols: number
          rows: number
          seq: number
          source: 'headless'
        }>((resolve) => {
          snapshotSequence = runtime.getPtyOutputSequence('pty-prompt')
          resolveSnapshot = resolve
        })
    )
    runtime.setPtyController({
      spawn: vi.fn().mockResolvedValue({ id: 'pty-prompt' }),
      write: (_ptyId, data) => {
        writes.push(data)
        if (data.includes(AGENT_PROMPT_BRACKETED_PASTE_END)) {
          runtime.onPtyData('pty-prompt', '\x1b[2J\x1b[H› review this', Date.now())
        }
        return true
      },
      kill: () => true,
      getForegroundProcess: async () => null,
      serializeProviderBuffer,
      hasRendererSerializer: () => false
    })
    const terminal = await runtime.createTerminal(`path:${WORKTREE_PATH}`, {
      launchAgent: 'aider'
    })
    runtime.synchronizePtyOutputSequenceFromProvider(
      'pty-prompt',
      { value: 900, generation: 'continued' },
      0
    )
    const submission = runtime.sendTerminalAgentPrompt(terminal.handle, 'review this')

    await vi.advanceTimersByTimeAsync(AGENT_PROMPT_EFFECT_TIMEOUT_MS + 500)
    await vi.waitFor(() => expect(serializeProviderBuffer).toHaveBeenCalledOnce())
    runtime.onPtyData('pty-prompt', '\x1b[2J\x1b[Hagent accepted', Date.now())
    resolveSnapshot({
      data: '\x1b[2J\x1b[H› review this',
      cols: 80,
      rows: 24,
      seq: snapshotSequence,
      source: 'headless'
    })
    await vi.runAllTimersAsync()

    await expect(submission).resolves.toMatchObject({ accepted: true })
    expect(writes.filter((data) => data === '\r')).toHaveLength(1)
  })

  it('does not reuse a provider composer snapshot captured before the current paste', async () => {
    vi.useFakeTimers()
    const runtime = new OrcaRuntimeService(makeStore() as never)
    const writes: string[] = []
    const serializeProviderBuffer = vi
      .fn()
      .mockResolvedValueOnce({
        data: '\x1b[2J\x1b[H› review this',
        cols: 80,
        rows: 24,
        seq: 900,
        source: 'headless' as const,
        alternateScreen: true
      })
      .mockResolvedValueOnce({
        data: '\x1b[2J\x1b[H› ',
        cols: 80,
        rows: 24,
        seq: 900,
        source: 'headless' as const,
        alternateScreen: true
      })
    runtime.setPtyController({
      spawn: vi.fn().mockResolvedValue({ id: 'pty-prompt' }),
      write: (_ptyId, data) => {
        writes.push(data)
        return true
      },
      kill: () => true,
      getForegroundProcess: async () => null,
      serializeProviderBuffer,
      hasRendererSerializer: () => false
    })
    const terminal = await runtime.createTerminal(`path:${WORKTREE_PATH}`, {
      launchAgent: 'aider'
    })
    runtime.synchronizePtyOutputSequenceFromProvider(
      'pty-prompt',
      { value: 900, generation: 'continued' },
      0
    )
    const internal = runtime as unknown as {
      providerSnapshotPreferredPtys: Set<string>
      readVisibleTerminalState: (ptyId: string) => Promise<unknown>
    }
    internal.providerSnapshotPreferredPtys.add('pty-prompt')
    await internal.readVisibleTerminalState('pty-prompt')
    expect(serializeProviderBuffer).toHaveBeenCalledOnce()

    const submission = runtime.sendTerminalAgentPrompt(terminal.handle, 'review this')
    const rejected = expect(submission).rejects.toThrow('agent_prompt_stalled')
    await vi.runAllTimersAsync()

    await rejected
    expect(serializeProviderBuffer).toHaveBeenCalledTimes(2)
    expect(writes.filter((data) => data === '\r')).toHaveLength(1)
  })

  it('blocks a retry when permission appears after the first Enter', async () => {
    vi.useFakeTimers()
    const { runtime, handle, writes } = await createPromptRuntime((runtime, data) => {
      if (data.includes(AGENT_PROMPT_BRACKETED_PASTE_END)) {
        runtime.onPtyData('pty-prompt', '\x1b[2J\x1b[H› review this', Date.now())
      } else if (data === '\r') {
        runtime.onPtyData('pty-prompt', '\x1b]0;Codex waiting for permission\x07', Date.now())
      }
    })
    const submission = runtime.sendTerminalAgentPrompt(handle, 'review this')
    const rejected = expect(submission).rejects.toThrow('agent_prompt_blocked')

    await vi.runAllTimersAsync()

    await rejected
    expect(writes.filter((data) => data === '\r')).toHaveLength(1)
  })

  it('serializes concurrent prompt submissions to one PTY', async () => {
    vi.useFakeTimers()
    const { runtime, handle, writes } = await createPromptRuntime((runtime, data) => {
      if (data === '\r') {
        runtime.onPtyData('pty-prompt', '\x1b]0;Codex working\x07', Date.now())
      }
    })

    const first = runtime.sendTerminalAgentPrompt(handle, 'first prompt')
    const second = runtime.sendTerminalAgentPrompt(handle, 'second prompt')
    await vi.runAllTimersAsync()
    await Promise.all([first, second])

    const firstPaste = writes.findIndex((data) => data.includes('first prompt'))
    const firstEnter = writes.indexOf('\r', firstPaste + 1)
    const secondPaste = writes.findIndex((data) => data.includes('second prompt'))
    const secondEnter = writes.indexOf('\r', secondPaste + 1)
    expect(firstPaste).toBeGreaterThanOrEqual(0)
    expect(firstEnter).toBeGreaterThan(firstPaste)
    expect(secondPaste).toBeGreaterThan(firstEnter)
    expect(secondEnter).toBeGreaterThan(secondPaste)
  })

  it('does not retry after the request is cancelled', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const { runtime, handle, writes } = await createPromptRuntime((runtime, data) => {
      if (data.includes(AGENT_PROMPT_BRACKETED_PASTE_END)) {
        runtime.onPtyData('pty-prompt', '\x1b[2J\x1b[H› review this', Date.now())
      }
    })
    const submission = runtime.sendTerminalAgentPrompt(handle, 'review this', {
      signal: controller.signal
    })
    const rejected = expect(submission).rejects.toThrow('request_aborted')

    await vi.advanceTimersByTimeAsync(AGENT_PROMPT_SUBMIT_DELAY_MS)
    controller.abort()
    await vi.runAllTimersAsync()

    await rejected
    expect(writes.filter((data) => data === '\r')).toHaveLength(1)
  })
})
