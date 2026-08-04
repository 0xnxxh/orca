// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DashboardCard } from '../../../../shared/dashboard-snapshot'
import { AgentChatPanel } from './AgentChatPanel'

const liveSession = vi.hoisted(() => vi.fn())
vi.mock('@/components/native-chat/use-native-chat-live-session', () => ({
  useNativeChatLiveSession: (args: unknown) => liveSession(args)
}))
vi.mock('@/components/native-chat/NativeChatMessageList', () => ({
  NativeChatMessageList: ({
    session,
    isWorking
  }: {
    session: { messages: { id: string }[] }
    isWorking: boolean
  }) => (
    <div
      data-testid="native-chat-list"
      data-working={isWorking}
      data-messages={session.messages.length}
    />
  )
}))

const terminalInput = vi.fn(async () => true)

function card(overrides: Partial<DashboardCard> = {}): DashboardCard {
  return {
    paneKey: 'tab-1:leaf-1',
    ptyId: 'pty-1',
    agentType: 'claude',
    bucket: 'working',
    dotState: 'working',
    task: 'Ship the chat panel',
    repoId: 'repo-1',
    worktreeId: 'worktree-1',
    tabId: 'tab-1',
    leafId: 'leaf-1',
    repoName: 'Orca',
    worktreeName: 'chat-panel',
    conversationName: 'Chat agent',
    hostKind: 'local',
    sessionId: 'session-1',
    transcriptPath: '/tmp/session-1.jsonl',
    startedAt: 1,
    finishedAt: null,
    stateChangedAt: 1,
    unseen: false,
    ...overrides
  }
}

beforeEach(() => {
  terminalInput.mockResolvedValue(true)
  liveSession.mockReturnValue({
    agent: 'claude',
    sessionId: 'session-1',
    messages: [{ id: 'm1', role: 'assistant' }],
    status: 'idle',
    hasMore: false,
    loadingEarlier: false,
    loadEarlier: vi.fn(),
    readPhase: 'ready'
  })
  ;(window as unknown as { api: unknown }).api = { terminalPreview: { input: terminalInput } }
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('AgentChatPanel', () => {
  it('reads the real transcript for the card session and heads it with the agent', () => {
    render(<AgentChatPanel card={card()} onClose={vi.fn()} />)

    expect(liveSession).toHaveBeenCalledWith({
      paneKey: 'tab-1:leaf-1',
      agent: 'claude',
      sessionId: 'session-1',
      transcriptPath: '/tmp/session-1.jsonl',
      runtimeEnvironmentId: null
    })
    expect(screen.getByTestId('native-chat-list')).toHaveAttribute('data-messages', '1')
    expect(screen.getByTestId('native-chat-list')).toHaveAttribute('data-working', 'true')
    expect(screen.getByRole('heading', { name: 'Chat agent' })).toBeInTheDocument()
    expect(screen.getByText('Orca / chat-panel')).toBeInTheDocument()
  })

  it('delays the separate submit so the TUI finishes accepting the body', async () => {
    vi.useFakeTimers()
    render(<AgentChatPanel card={card()} onClose={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Reply to this agent'), {
      target: { value: 'ship it' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await act(async () => {})
    expect(terminalInput).toHaveBeenCalledTimes(2)
    expect(terminalInput).toHaveBeenNthCalledWith(1, 'pty-1', '\x15')
    expect(terminalInput).toHaveBeenNthCalledWith(2, 'pty-1', 'ship it')

    await act(async () => vi.advanceTimersByTimeAsync(499))
    expect(terminalInput).toHaveBeenCalledTimes(2)

    await act(async () => vi.advanceTimersByTimeAsync(1))
    expect(terminalInput).toHaveBeenCalledTimes(3)
    expect(terminalInput).toHaveBeenNthCalledWith(3, 'pty-1', '\r')
    expect(screen.getByLabelText('Reply to this agent')).toHaveValue('')
  })

  it('blocks retries after the body lands but its delayed submit is refused', async () => {
    vi.useFakeTimers()
    terminalInput
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
    render(<AgentChatPanel card={card()} onClose={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Reply to this agent'), {
      target: { value: 'ship it' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await act(async () => {})
    expect(screen.getByLabelText('Reply to this agent')).toHaveValue('')

    await act(async () => vi.advanceTimersByTimeAsync(500))
    expect(screen.getByText(/is in the terminal but could not be submitted/)).toBeInTheDocument()
    expect(screen.getByLabelText('Reply to this agent')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    expect(terminalInput).toHaveBeenCalledTimes(3)
  })

  it('reports a refused write instead of pretending the reply landed', async () => {
    terminalInput.mockResolvedValueOnce(false)
    render(<AgentChatPanel card={card()} onClose={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Reply to this agent'), { target: { value: 'hello' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect(await screen.findByText(/did not reach the agent/)).toBeInTheDocument()
    expect(terminalInput).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('Reply to this agent')).toHaveValue('hello')
  })

  it('withholds the composer when the agent has no live pane', () => {
    render(<AgentChatPanel card={card({ ptyId: null })} onClose={vi.fn()} />)

    expect(
      screen.getByText('No live pane, so a reply cannot reach this agent.')
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument()
  })

  it('degrades to snapshot text when the card has no session', () => {
    render(
      <AgentChatPanel
        card={card({
          sessionId: undefined,
          transcriptPath: undefined,
          bucket: 'attention',
          dotState: 'waiting',
          askSummary: 'Approve the migration?',
          lastAgentMessage: 'I paused before the migration.'
        })}
        onClose={vi.fn()}
      />
    )

    expect(liveSession).not.toHaveBeenCalled()
    expect(screen.queryByTestId('native-chat-list')).not.toBeInTheDocument()
    expect(screen.getByText(/has not reported a session yet/)).toBeInTheDocument()
    expect(screen.getByText('Approve the migration?')).toBeInTheDocument()
    expect(screen.getByText('I paused before the migration.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument()
  })

  it('degrades on a remote host whose transcript path is not local', () => {
    render(<AgentChatPanel card={card({ hostKind: 'ssh' })} onClose={vi.fn()} />)

    expect(liveSession).not.toHaveBeenCalled()
    expect(screen.getByText(/transcript is on another host/)).toBeInTheDocument()
  })

  it('degrades on WSL instead of reading a Linux path through local IPC', () => {
    render(<AgentChatPanel card={card({ hostKind: 'wsl' })} onClose={vi.fn()} />)

    expect(liveSession).not.toHaveBeenCalled()
    expect(screen.getByText(/transcript is on another host/)).toBeInTheDocument()
  })

  it('shows transcript loading and read failures instead of an empty conversation', () => {
    liveSession.mockReturnValueOnce({
      ...liveSession(),
      messages: [],
      status: 'loading',
      readPhase: 'loading'
    })
    const { rerender } = render(<AgentChatPanel card={card()} onClose={vi.fn()} />)
    expect(screen.getByText('Loading conversation…')).toBeInTheDocument()

    liveSession.mockReturnValueOnce({
      ...liveSession(),
      messages: [],
      status: 'error',
      error: 'Transcript permission denied',
      readPhase: 'error'
    })
    rerender(<AgentChatPanel card={card()} onClose={vi.fn()} />)
    expect(screen.getByText('Transcript permission denied')).toBeInTheDocument()
    expect(screen.queryByText('No messages in this transcript yet.')).not.toBeInTheDocument()
  })

  it('escalates to the terminal and closes on request', () => {
    const onClose = vi.fn()
    const onOpenTerminal = vi.fn()
    render(<AgentChatPanel card={card()} onClose={onClose} onOpenTerminal={onOpenTerminal} />)

    fireEvent.click(screen.getByRole('button', { name: 'Open terminal' }))
    expect(onOpenTerminal).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Close chat' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
