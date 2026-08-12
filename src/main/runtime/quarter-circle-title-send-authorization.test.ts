// STA-4028 (regression from #13925): quarter circles are ordinary progress glyphs —
// ora, installers, any TUI animates them — so a title carrying nothing else must not
// authorize a guarded send, which auto-submits with Enter into whatever owns the pane.
import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'
import { assertTerminalAgentSendable } from './rpc/terminal-agent-send-guard'
import { detectAgentStatusFromTitle } from '../../shared/agent-detection'

vi.mock('electron', () => ({
  BrowserWindow: { fromId: vi.fn(() => null) },
  webContents: { fromId: vi.fn(() => null) },
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp') }
}))

const LEAF_ID = '11111111-1111-4111-8111-111111111111'
const TAB_ID = 'tab-1'
const WORKTREE_ID = 'wt-1'
const PTY_ID = 'pty-1'

// A quarter-circle spinner with no agent token — Claude Code 2.1.228's task-text
// busy frame reads the same as a release script animating its own OSC title.
const SPINNER_ONLY_TITLE = '◑ Deploying release 4.2'
const SPINNER_WITH_IDENTITY_TITLE = '◐ Claude Code'
const BRAILLE_SPINNER_ONLY_TITLE = '⠂ Deploying release 4.2'

async function createRuntimeWithTitle(
  paneTitle: string,
  foregroundProcess: string | null
): Promise<{ runtime: OrcaRuntimeService; handle: string }> {
  const runtime = new OrcaRuntimeService(null)
  const internals = runtime as unknown as {
    resolveTerminalWorkspaceLaunchScope: (selector: string) => Promise<unknown>
  }
  vi.spyOn(internals, 'resolveTerminalWorkspaceLaunchScope').mockResolvedValue({
    id: WORKTREE_ID,
    path: '/repo/app',
    connectionId: null,
    repo: null,
    folderWorkspace: null
  })
  runtime.setPtyController({
    spawn: vi.fn().mockResolvedValue({ id: PTY_ID }),
    write: () => true,
    kill: () => true,
    getForegroundProcess: async () => foregroundProcess
  })
  const terminal = await runtime.createTerminal(`id:${WORKTREE_ID}`, {
    tabId: TAB_ID,
    leafId: LEAF_ID,
    title: 'Terminal'
  })
  runtime.attachWindow(1)
  runtime.syncWindowGraph(1, {
    tabs: [
      {
        tabId: TAB_ID,
        worktreeId: WORKTREE_ID,
        title: 'Terminal',
        activeLeafId: LEAF_ID,
        layout: null
      }
    ],
    leaves: [
      {
        tabId: TAB_ID,
        worktreeId: WORKTREE_ID,
        leafId: LEAF_ID,
        paneRuntimeId: 1,
        ptyId: PTY_ID,
        paneTitle
      }
    ]
  })
  return { runtime, handle: terminal.handle }
}

const AUTHORIZED = 'authorized'

async function guardedSendResult(runtime: OrcaRuntimeService, handle: string): Promise<string> {
  try {
    await assertTerminalAgentSendable({ runtime, handle, assertWritable: () => {} })
    return AUTHORIZED
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

describe('quarter-circle title send authorization (STA-4028)', () => {
  it('refuses a guarded send when a quarter-circle spinner is the only agent evidence', async () => {
    const { runtime, handle } = await createRuntimeWithTitle(SPINNER_ONLY_TITLE, 'node')

    await expect(runtime.getTerminalAgentStatus(handle)).resolves.toMatchObject({
      isRunningAgent: false
    })
    await expect(guardedSendResult(runtime, handle)).resolves.toBe('terminal_guard_no_agent')
  })

  it('refuses a guarded send when the foreground process cannot be read at all', async () => {
    // Why: SSH and folder-workspace panes can fail the foreground read; no evidence
    // stays a refusal rather than falling back to the glyph.
    const { runtime, handle } = await createRuntimeWithTitle(SPINNER_ONLY_TITLE, null)

    await expect(guardedSendResult(runtime, handle)).resolves.toBe('terminal_guard_no_agent')
  })

  it('authorizes a guarded send when the foreground process is a recognized agent', async () => {
    const { runtime, handle } = await createRuntimeWithTitle(SPINNER_ONLY_TITLE, 'claude')

    await expect(runtime.getTerminalAgentStatus(handle)).resolves.toMatchObject({
      isRunningAgent: true,
      status: 'working'
    })
    await expect(guardedSendResult(runtime, handle)).resolves.toBe(AUTHORIZED)
  })

  it('authorizes a guarded send when the busy title itself names the agent', async () => {
    const { runtime, handle } = await createRuntimeWithTitle(SPINNER_WITH_IDENTITY_TITLE, null)

    await expect(runtime.getTerminalAgentStatus(handle)).resolves.toMatchObject({
      isRunningAgent: true,
      status: 'working'
    })
    await expect(guardedSendResult(runtime, handle)).resolves.toBe(AUTHORIZED)
  })

  it('leaves braille-spinner authorization unchanged', async () => {
    const { runtime, handle } = await createRuntimeWithTitle(BRAILLE_SPINNER_ONLY_TITLE, null)

    await expect(guardedSendResult(runtime, handle)).resolves.toBe(AUTHORIZED)
  })

  it('keeps the quarter-circle glyph a working activity signal (#13889)', async () => {
    expect(detectAgentStatusFromTitle(SPINNER_ONLY_TITLE)).toBe('working')
    expect(detectAgentStatusFromTitle(SPINNER_WITH_IDENTITY_TITLE)).toBe('working')
  })
})
