// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type {
  DashboardCard,
  DashboardCardTerminalInput
} from '../../../../shared/dashboard-snapshot'
import { AgentTerminalDialog, AgentTerminalPanel } from './AgentTerminalDialog'

// Stub the preview so the assertion is on the props the dialog hands it, with
// no xterm / IPC machinery in the way.
vi.mock('./AgentTerminalPreview', () => ({
  AgentTerminalPreview: ({
    ptyId,
    terminalInput,
    className
  }: {
    ptyId: string
    terminalInput?: DashboardCardTerminalInput | null
    className?: string
  }) => (
    <div
      data-testid="preview"
      data-pty-id={ptyId}
      data-terminal-input={terminalInput === null ? 'null' : JSON.stringify(terminalInput)}
      className={className}
    />
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

afterEach(() => {
  cleanup()
})

// Why: this is the only seam carrying the relayed host profile into the
// emulator. Dropping the prop degrades every preview to client-OS byte routing
// silently — nothing else in the app reads DashboardCard.terminalInput.
describe('AgentTerminalDialog', () => {
  it("hands the card's relayed host-input profile to the preview terminal", () => {
    render(
      <AgentTerminalDialog
        card={card({ terminalInput: TERMINAL_INPUT })}
        onOpenChange={() => {}}
        onReveal={() => {}}
      />
    )

    expect(screen.getByTestId('preview')).toHaveAttribute(
      'data-terminal-input',
      JSON.stringify(TERMINAL_INPUT)
    )
  })

  it('passes null when the card carries no profile, so the preview routes by client OS', () => {
    render(<AgentTerminalDialog card={card()} onOpenChange={() => {}} onReveal={() => {}} />)

    expect(screen.getByTestId('preview')).toHaveAttribute('data-terminal-input', 'null')
  })

  it('offers ring result disposition actions without replacing the shared terminal dialog', () => {
    const result = card({ bucket: 'done', dotState: 'done', finishedAt: 100 })
    const onOpenChange = vi.fn()
    const onMarkReviewed = vi.fn()
    const onTogglePinned = vi.fn()
    render(
      <AgentTerminalDialog
        card={result}
        onOpenChange={onOpenChange}
        onReveal={() => {}}
        reviewed={false}
        pinned={false}
        onMarkReviewed={onMarkReviewed}
        onTogglePinned={onTogglePinned}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Keep visible' }))
    expect(onTogglePinned).toHaveBeenCalledWith(result)
    fireEvent.click(screen.getByRole('button', { name: 'Mark reviewed' }))
    expect(onMarkReviewed).toHaveBeenCalledWith(result)
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(screen.getByTestId('preview')).toHaveAttribute('data-pty-id', 'pty-1')
  })

  it('keeps a pinned reviewed result open', () => {
    const onOpenChange = vi.fn()
    render(
      <AgentTerminalDialog
        card={card({ bucket: 'done', dotState: 'done', finishedAt: 100 })}
        onOpenChange={onOpenChange}
        onReveal={() => {}}
        reviewed={false}
        pinned
        onMarkReviewed={() => {}}
        onTogglePinned={() => {}}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Mark reviewed' }))
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('reuses the terminal surface as a non-modal adjacent panel', () => {
    render(<AgentTerminalPanel card={card()} onOpenChange={() => {}} onReveal={() => {}} />)

    expect(screen.getByTestId('preview')).toHaveClass('min-h-0', 'flex-1')
    expect(document.querySelector('[data-slot="dialog-overlay"]')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'wt' })).toBeInTheDocument()
  })
})
