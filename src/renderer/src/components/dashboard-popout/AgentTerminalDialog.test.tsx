// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type {
  DashboardCard,
  DashboardCardTerminalInput
} from '../../../../shared/dashboard-snapshot'
import { AgentTerminalDialog } from './AgentTerminalDialog'

const previewModuleLoad = vi.hoisted(() => vi.fn())

// Stub the preview so the assertion is on the props the dialog hands it, with
// no xterm / IPC machinery in the way.
vi.mock('./AgentTerminalPreview', () => {
  previewModuleLoad()
  return {
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
  }
})

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
  it('loads the terminal preview only when the dialog card has a live PTY', async () => {
    const { rerender } = render(
      <AgentTerminalDialog
        card={card({ ptyId: null })}
        onOpenChange={() => {}}
        onReveal={() => {}}
      />
    )

    expect(previewModuleLoad).not.toHaveBeenCalled()
    expect(screen.queryByTestId('preview')).not.toBeInTheDocument()

    rerender(<AgentTerminalDialog card={card()} onOpenChange={() => {}} onReveal={() => {}} />)

    expect(await screen.findByTestId('preview')).toHaveAttribute('data-pty-id', 'pty-1')
    expect(previewModuleLoad).toHaveBeenCalledOnce()
  })

  it("hands the card's relayed host-input profile to the preview terminal", async () => {
    render(
      <AgentTerminalDialog
        card={card({ terminalInput: TERMINAL_INPUT })}
        onOpenChange={() => {}}
        onReveal={() => {}}
      />
    )

    expect(await screen.findByTestId('preview')).toHaveAttribute(
      'data-terminal-input',
      JSON.stringify(TERMINAL_INPUT)
    )
  })

  it('passes null when the card carries no profile, so the preview routes by client OS', async () => {
    render(<AgentTerminalDialog card={card()} onOpenChange={() => {}} onReveal={() => {}} />)

    expect(await screen.findByTestId('preview')).toHaveAttribute('data-terminal-input', 'null')
  })
})
