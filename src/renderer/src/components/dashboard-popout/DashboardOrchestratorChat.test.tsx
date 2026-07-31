// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DashboardCard } from '../../../../shared/dashboard-snapshot'
import { buildNativeChatPasteBytes } from '@/components/native-chat/native-chat-send'
import { DashboardOrchestratorChat } from './DashboardOrchestratorChat'
import { DASHBOARD_ORCHESTRATOR_CONTEXT_MIME } from './dashboard-orchestrator-context'
import * as dashboardOrchestratorContext from './dashboard-orchestrator-context'

vi.mock('@/lib/agent-catalog', () => ({
  AgentIcon: ({ agent }: { agent: string }) => <span data-agent-icon={agent} />
}))

function card(overrides: Partial<DashboardCard> = {}): DashboardCard {
  return {
    paneKey: 'pane-1',
    ptyId: 'pty-1',
    agentType: 'codex',
    bucket: 'working',
    dotState: 'working',
    task: 'Coordinate the fleet',
    repoId: 'repo-1',
    worktreeId: 'worktree-1',
    tabId: 'tab-1',
    leafId: 'leaf-1',
    repoName: 'Orca',
    worktreeName: 'Fleet',
    conversationName: 'Coordinator',
    startedAt: 1,
    finishedAt: null,
    stateChangedAt: 10,
    unseen: false,
    ...overrides
  }
}

function dataTransfer(): DataTransfer {
  const values = new Map<string, string>()
  return {
    dropEffect: 'none',
    effectAllowed: 'none',
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    types: [DASHBOARD_ORCHESTRATOR_CONTEXT_MIME],
    clearData: vi.fn(),
    getData: (type: string) => values.get(type) ?? '',
    setData: (type: string, value: string) => {
      values.set(type, value)
    },
    setDragImage: vi.fn()
  } as DataTransfer
}

describe('DashboardOrchestratorChat', () => {
  const input = vi.fn(async () => true)

  beforeEach(() => {
    Object.assign(window, { api: { terminalPreview: { input } } })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('keeps the transport route hidden while dispatching through the strongest coordinator', async () => {
    const coordinator = card({
      paneKey: 'coordinator',
      ptyId: 'pty-coordinator',
      subagents: [{ id: 'child', name: 'Reviewer', dotState: 'working' }]
    })
    render(
      <DashboardOrchestratorChat
        cards={[card({ paneKey: 'worker', ptyId: 'pty-worker' }), coordinator]}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Orchestrate' }))
    expect(await screen.findByText('Global fleet · 2 agents')).toBeInTheDocument()
    expect(screen.getByText('$orchestration')).toBeInTheDocument()
    expect(screen.queryByText(/Routes through/)).not.toBeInTheDocument()
    const composer = screen.getByRole('textbox', { name: 'Message the orchestrator' })
    fireEvent.change(composer, { target: { value: 'Summarize the risky work.' } })
    fireEvent.keyDown(composer, { key: 'Enter' })

    await waitFor(() => expect(input).toHaveBeenCalledTimes(2))
    expect(input).toHaveBeenNthCalledWith(
      1,
      'pty-coordinator',
      buildNativeChatPasteBytes(
        '$orchestration Coordinate this request across the entire Orca fleet.\n\nSummarize the risky work.'
      )
    )
    expect(input).toHaveBeenNthCalledWith(2, 'pty-coordinator', '\r')
    expect(await screen.findByText('Summarize the risky work.')).toBeInTheDocument()
    expect(composer).toHaveValue('')
  })

  it('builds the fleet hierarchy only while the orchestrator is open', async () => {
    const buildProjects = vi.spyOn(
      dashboardOrchestratorContext,
      'buildDashboardOrchestratorProjects'
    )
    const { rerender } = render(<DashboardOrchestratorChat cards={[card()]} />)

    expect(buildProjects).not.toHaveBeenCalled()
    rerender(<DashboardOrchestratorChat cards={[card({ stateChangedAt: 20 })]} />)
    expect(buildProjects).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Orchestrate' }))
    await waitFor(() => expect(buildProjects).toHaveBeenCalledOnce())
    buildProjects.mockRestore()
  })

  it('adds a dragged agent to the prompt context', async () => {
    render(<DashboardOrchestratorChat cards={[card()]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Orchestrate' }))
    const transfer = dataTransfer()
    fireEvent.dragStart(
      await screen.findByRole('button', {
        name: 'Add Coordinator to orchestration context'
      }),
      { dataTransfer: transfer }
    )
    const dropZone = document.querySelector('[data-orchestrator-drop-zone]')
    expect(dropZone).not.toBeNull()
    fireEvent.dragOver(dropZone as Element, { dataTransfer: transfer })
    fireEvent.drop(dropZone as Element, { dataTransfer: transfer })

    const composer = screen.getByRole('textbox', { name: 'Message the orchestrator' })
    fireEvent.change(composer, { target: { value: 'Check this agent.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(input).toHaveBeenCalledTimes(2))
    expect(input).toHaveBeenNthCalledWith(
      1,
      'pty-1',
      buildNativeChatPasteBytes(
        '$orchestration Coordinate this request with these selected fleet participants: agent "Coordinator" in workspace "Fleet".\n\nCheck this agent.'
      )
    )
  })

  it('hides the introduction manually and after the first message', async () => {
    const first = render(<DashboardOrchestratorChat cards={[card()]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Orchestrate' }))
    expect(await screen.findByText('One conversation, fleet-wide context')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Hide introduction' }))
    expect(screen.queryByText('One conversation, fleet-wide context')).not.toBeInTheDocument()
    first.unmount()

    render(<DashboardOrchestratorChat cards={[card()]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Orchestrate' }))
    const composer = await screen.findByRole('textbox', { name: 'Message the orchestrator' })
    fireEvent.change(composer, { target: { value: 'Start coordinating.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(input).toHaveBeenCalledTimes(2))
    expect(screen.queryByText('One conversation, fleet-wide context')).not.toBeInTheDocument()
  })

  it('does not surface the backing agent conversation before a new orchestration reply', async () => {
    const { rerender } = render(
      <DashboardOrchestratorChat cards={[card({ lastAgentMessage: 'Unrelated PR discussion' })]} />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Orchestrate' }))
    expect(screen.queryByText('Unrelated PR discussion')).not.toBeInTheDocument()

    const composer = screen.getByRole('textbox', { name: 'Message the orchestrator' })
    fireEvent.change(composer, { target: { value: 'Inspect the fleet.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(input).toHaveBeenCalledTimes(2))

    rerender(
      <DashboardOrchestratorChat
        cards={[card({ lastAgentMessage: 'Three agents need your attention.' })]}
      />
    )
    expect(await screen.findByText('Three agents need your attention.')).toBeInTheDocument()
  })

  it('keeps the draft when the live terminal rejects the request', async () => {
    input.mockResolvedValueOnce(false)
    render(<DashboardOrchestratorChat cards={[card()]} />)

    fireEvent.click(screen.getByRole('button', { name: 'Orchestrate' }))
    const composer = await screen.findByRole('textbox', { name: 'Message the orchestrator' })
    fireEvent.change(composer, { target: { value: 'Try this again.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect(await screen.findByText('Send failed')).toBeInTheDocument()
    expect(composer).toHaveValue('Try this again.')
  })

  it('reports the absence of a live agent without overclaiming availability', async () => {
    const { container } = render(
      <DashboardOrchestratorChat
        cards={[card({ ptyId: null, bucket: 'done', dotState: 'done' })]}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Orchestrate' }))

    expect(await screen.findByText('No live agent')).toBeInTheDocument()
    expect(screen.getByText('Start a live agent to enable orchestration')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    expect(container.querySelector('.bg-status-success')).not.toBeInTheDocument()
  })
})
