// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  DashboardCard,
  DashboardCardTerminalInput
} from '../../../../shared/dashboard-snapshot'
import { AgentDashboardInspectorDrawer } from './AgentDashboardInspectorDrawer'

vi.mock('./AgentTerminalPreview', () => ({
  AgentTerminalPreview: ({
    ptyId,
    terminalInput
  }: {
    ptyId: string
    terminalInput?: DashboardCardTerminalInput | null
  }) => (
    <div
      data-testid="preview"
      data-pty-id={ptyId}
      data-terminal-input={terminalInput === null ? 'null' : JSON.stringify(terminalInput)}
    />
  )
}))

vi.mock('./AgentChatPanel', () => ({
  AgentChatPanel: ({
    onClose,
    onOpenTerminal,
    className
  }: {
    onClose: () => void
    onOpenTerminal: () => void
    className?: string
  }) => (
    <div data-testid="chat-panel" className={className}>
      <button onClick={onOpenTerminal}>Open terminal</button>
      <button onClick={onClose}>Close chat</button>
    </div>
  )
}))

const TERMINAL_INPUT: DashboardCardTerminalInput = {
  hostPlatform: 'win32',
  localWindowsConpty: true,
  osRelease: '10.0.22631',
  windowsShiftEnterEncoding: 'csi-u',
  kittyKeyboardAdvertised: false
}

function card(overrides: Partial<DashboardCard> = {}): DashboardCard {
  return {
    paneKey: 'tab1:leaf1',
    ptyId: 'pty-1',
    agentType: 'claude',
    bucket: 'working',
    dotState: 'working',
    task: 'task',
    repoId: 'r1',
    worktreeId: 'w1',
    tabId: 'tab1',
    leafId: 'leaf1',
    repoName: 'Repo',
    worktreeName: 'wt',
    startedAt: 0,
    finishedAt: null,
    stateChangedAt: 0,
    unseen: false,
    ...overrides
  }
}

afterEach(cleanup)

describe('AgentDashboardInspectorDrawer', () => {
  it('renders terminal details in a left slideout sheet', () => {
    render(
      <AgentDashboardInspectorDrawer
        card={card({ terminalInput: TERMINAL_INPUT })}
        onOpenChange={() => {}}
        onReveal={() => {}}
      />
    )

    expect(document.querySelector('[data-slot="sheet-content"]')).toHaveClass(
      'left-0',
      'data-[state=open]:slide-in-from-left',
      'p-0'
    )
    expect(screen.getByTestId('preview')).toHaveAttribute(
      'data-terminal-input',
      JSON.stringify(TERMINAL_INPUT)
    )
    expect(screen.queryByTestId('chat-panel')).not.toBeInTheDocument()
  })

  it('opens native chat for chat-mode cards and can switch to terminal preview', () => {
    render(
      <AgentDashboardInspectorDrawer
        card={card({ viewMode: 'chat' })}
        onOpenChange={() => {}}
        onReveal={() => {}}
      />
    )

    expect(screen.getByTestId('chat-panel')).toHaveClass('m-0', 'rounded-none', 'shadow-none')
    expect(screen.queryByTestId('preview')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Open terminal' }))
    expect(screen.getByTestId('preview')).toHaveAttribute('data-pty-id', 'pty-1')
    expect(screen.queryByTestId('chat-panel')).not.toBeInTheDocument()
  })

  it('closes the drawer after revealing the worktree', () => {
    const onOpenChange = vi.fn()
    const onReveal = vi.fn()
    render(
      <AgentDashboardInspectorDrawer
        card={card()}
        onOpenChange={onOpenChange}
        onReveal={onReveal}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open worktree' }))

    expect(onReveal).toHaveBeenCalledWith({
      repoId: 'r1',
      worktreeId: 'w1',
      tabId: 'tab1',
      leafId: 'leaf1'
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
