import { describe, expect, it, vi } from 'vitest'
import type { StructuredAgentSessionHandoffTransport } from '../native-chat/agent-session-wire/structured-agent-session-handoff-types'
import { OrcaRuntimeService } from './orca-runtime'

const { probeAgentSessionProcessIdentity, readStructuredTuiProcessIdentity } = vi.hoisted(() => ({
  probeAgentSessionProcessIdentity: vi.fn(),
  readStructuredTuiProcessIdentity: vi.fn()
}))

vi.mock('./structured-tui-process-identity', () => ({ readStructuredTuiProcessIdentity }))
vi.mock('./agent-session-process-identity-probe', async (importOriginal) => ({
  ...(await importOriginal()),
  probeAgentSessionProcessIdentity
}))

const WORKTREE_ID = 'repo-1::/tmp/structured-handoff'

function notifier(revealTerminalSession: ReturnType<typeof vi.fn>) {
  return {
    worktreesChanged: vi.fn(),
    reposChanged: vi.fn(),
    activateWorktree: vi.fn(),
    createTerminal: vi.fn(),
    revealTerminalSession,
    splitTerminal: vi.fn(),
    renameTerminal: vi.fn(),
    focusTerminal: vi.fn(),
    closeTerminal: vi.fn(),
    sleepWorktree: vi.fn(),
    terminalFitOverrideChanged: vi.fn(),
    terminalDriverChanged: vi.fn()
  }
}

describe('structured TUI launch tab binding', () => {
  it('proves the published launch tab before returning its revealed renderer binding', async () => {
    const revealTerminalSession = vi.fn(
      (_worktreeId: string, _options: { tabId?: string; leafId?: string; ptyId?: string }) =>
        Promise.resolve({ tabId: 'tab-renderer' })
    )
    const runtime = new OrcaRuntimeService({
      getSettings: () => ({
        disabledTuiAgents: [],
        agentCmdOverrides: {},
        agentDefaultArgs: {},
        agentDefaultEnv: {}
      })
    } as never)
    runtime.setNotifier(notifier(revealTerminalSession) as never)
    runtime.setPtyController({
      spawn: vi.fn().mockResolvedValue({ id: 'pty-structured', pid: 4242 }),
      write: () => true,
      kill: () => true,
      getForegroundProcess: async () => null
    })

    const internal = runtime as unknown as {
      createStructuredAgentSessionHandoffTransport(): StructuredAgentSessionHandoffTransport
      resolveTerminalWorkspaceLaunchScope(): Promise<{
        id: string
        path: string
        connectionId: null
        repo: null
        folderWorkspace: null
      }>
      markLocalWorkspaceTrustedForAgent(): void
      waitForTerminal(): Promise<unknown>
      waitForStructuredTuiProof(): Promise<{ transcriptPath?: string }>
    }
    internal.resolveTerminalWorkspaceLaunchScope = vi.fn(async () => ({
      id: WORKTREE_ID,
      path: '/tmp/structured-handoff',
      connectionId: null,
      repo: null,
      folderWorkspace: null
    }))
    internal.markLocalWorkspaceTrustedForAgent = vi.fn()
    const waitForTerminal = vi.fn(async () => ({}))
    internal.waitForTerminal = waitForTerminal
    const waitForStructuredTuiProof = vi.fn(async () => {
      const snapshot = await runtime.listMobileSessionTabs(`id:${WORKTREE_ID}`)
      expect(snapshot.tabs).toContainEqual(
        expect.objectContaining({
          type: 'terminal',
          parentTabId: expect.any(String),
          leafId: expect.any(String),
          ptyId: 'pty-structured',
          terminal: expect.any(String)
        })
      )
      expect(revealTerminalSession).not.toHaveBeenCalled()
      return { transcriptPath: '/tmp/rollout.jsonl' }
    })
    internal.waitForStructuredTuiProof = waitForStructuredTuiProof
    readStructuredTuiProcessIdentity.mockResolvedValue({
      hostId: 'local',
      pid: 4243,
      processStartTimeMs: 10,
      spawnToken: 'spawn-token'
    })
    probeAgentSessionProcessIdentity.mockResolvedValue({
      outcome: 'identity-matched',
      matchedOn: ['process-start-time']
    })

    const transport = internal.createStructuredAgentSessionHandoffTransport()
    const owner = await transport.launchTui({
      record: {
        sessionId: 'session-1',
        location: { workspaceId: WORKTREE_ID, executionHostId: 'local' },
        accountHome: { variable: 'CODEX_HOME', path: '/tmp/codex-home' },
        providerHandleChain: [
          { handle: { provider: 'codex', threadId: 'thread-1' }, observedAt: 1 }
        ]
      } as never,
      fence: 3,
      spawnToken: 'spawn-token'
    })

    const reveal = revealTerminalSession.mock.calls[0]?.[1] as {
      tabId: string
      leafId: string
    }
    expect(owner.terminal).toMatchObject({
      tabId: 'tab-renderer',
      paneKey: `${reveal.tabId}:${reveal.leafId}`
    })
    expect(waitForTerminal).toHaveBeenCalledWith(
      owner.terminal.handle,
      expect.objectContaining({ condition: 'tui-idle' })
    )
    expect(waitForStructuredTuiProof).toHaveBeenCalledOnce()
    expect(waitForStructuredTuiProof.mock.invocationCallOrder[0]).toBeLessThan(
      revealTerminalSession.mock.invocationCallOrder[0]!
    )

    const pty = (
      runtime as unknown as {
        ptysById: Map<string, { launchToken: string | null }>
      }
    ).ptysById.get('pty-structured')!
    pty.launchToken = null
    const persistedRecord = {
      sessionId: 'session-1',
      providerHandleChain: [{ handle: { provider: 'codex', threadId: 'thread-1' }, observedAt: 1 }],
      lease: { ownerProcess: owner.process, provenHandleLinkId: owner.link.linkId }
    } as never

    await expect(transport.reproveTuiOwner({ record: persistedRecord, owner })).resolves.toEqual(
      owner
    )
    expect(waitForStructuredTuiProof).toHaveBeenCalledOnce()
  })
})
