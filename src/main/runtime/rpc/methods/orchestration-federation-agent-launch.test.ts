import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from '../../orca-runtime'
import { OrchestrationDb } from '../../orchestration/db'
import { ORCHESTRATION_METHODS } from './orchestration'

// Why: a federated worker terminal is created from an agent id. Passing that id
// as a shell command launched Cursor's desktop app instead of `cursor-agent`
// (issue #11926), so the remote path must resolve through the TUI agent config
// exactly like the local one.
describe('federated worker agent launch', () => {
  let db: OrchestrationDb | undefined

  afterEach(() => {
    db?.close()
    vi.restoreAllMocks()
  })

  it('creates the remote worker terminal from the agent id, never as a command', async () => {
    db = new OrchestrationDb(':memory:')
    const runtime = new OrcaRuntimeService()
    runtime.setOrchestrationDb(db)
    vi.spyOn(runtime, 'validateOrchestrationAgentLauncher').mockImplementation(() => {})
    vi.spyOn(runtime, 'showManagedWorktree').mockResolvedValue({
      id: 'repo::remote-worktree'
    } as never)
    const createTerminal = vi.spyOn(runtime, 'createTerminal').mockResolvedValue({
      handle: 'term_remote_worker',
      worktreeId: 'repo::remote-worktree',
      title: 'worker'
    })
    vi.spyOn(runtime, 'waitForTerminal').mockResolvedValue({
      handle: 'term_remote_worker',
      condition: 'tui-idle',
      satisfied: true,
      status: 'running',
      exitCode: null
    })
    const method = ORCHESTRATION_METHODS.find(
      (candidate) => candidate.name === 'orchestration.federationAttachStart'
    )
    if (!method) {
      throw new Error('federationAttachStart method is not registered')
    }

    await method.handler(
      method.params!.parse({
        dispatchId: 'ctx_remote',
        taskId: 'task_remote',
        taskSpec: 'remote cursor worker',
        protocolVersion: 1,
        worktree: 'id:repo::remote-worktree',
        agent: 'cursor'
      }),
      {
        runtime,
        orchestrationMutation: {
          callerFingerprint: 'home_peer',
          requestId: 'request_remote',
          method: 'orchestration.federationAttachStart',
          payloadHash: 'remote_payload'
        }
      }
    )

    expect(createTerminal).toHaveBeenCalledWith(
      'id:repo::remote-worktree',
      expect.objectContaining({ startupAgent: 'cursor' })
    )
    expect(createTerminal).toHaveBeenCalledWith(
      'id:repo::remote-worktree',
      expect.not.objectContaining({ command: expect.anything() })
    )
  })
})
