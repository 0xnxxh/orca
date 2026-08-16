import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'
import { getDefaultWorkspaceSession } from '../../shared/constants'

// The aggregate inventory only enumerates registered providers, so a dropped
// relay clears `connected` for every one of its PTYs at once. Only the
// provider's own answer separates an observed exit from lost contact.

const WORKTREE_ID = 'repo-1::/tmp/inventory-verdict'
const REMOTE_PTY_ID = 'ssh:conn-1@@relay-9'

function makeStore() {
  const session = getDefaultWorkspaceSession()
  return {
    getWorkspaceSession: vi.fn(() => session),
    setWorkspaceSession: vi.fn(),
    getRepos: vi.fn(() => [
      {
        id: 'repo-1',
        path: '/tmp/inventory-verdict',
        displayName: 'inventory-verdict',
        badgeColor: '#000000',
        addedAt: 0
      }
    ]),
    getAllWorktreeMeta: vi.fn(() => ({})),
    getWorktreeMeta: vi.fn(() => undefined),
    setWorktreeMeta: vi.fn(),
    removeWorktreeMeta: vi.fn(),
    getSettings: vi.fn(() => ({ workspaceDir: '/tmp/workspaces' })),
    getProjects: vi.fn(() => [])
  }
}

function makeRuntimeMissingFromInventory(hasPty: () => boolean | null): OrcaRuntimeService {
  const runtime = new OrcaRuntimeService(makeStore() as never)
  runtime.setPtyController({
    write: () => true,
    kill: () => true,
    hasPty,
    listProcesses: vi.fn(async () => []),
    getForegroundProcess: async () => null
  } as never)
  runtime.attachWindow(1)
  runtime.syncWindowGraph(1, { tabs: [], leaves: [] })
  runtime.registerPty(REMOTE_PTY_ID, WORKTREE_ID, 'conn-1')
  return runtime
}

describe('inventory sweep liveness verdicts', () => {
  it('records lost contact when no provider can answer for the PTY', async () => {
    const runtime = makeRuntimeMissingFromInventory(() => null)

    await runtime.listTerminals(`id:${WORKTREE_ID}`)

    expect(runtime.getPtyLivenessVerdict(REMOTE_PTY_ID)).toEqual({
      status: 'unverifiable',
      reason: 'no registered provider can observe its host'
    })
  })

  it('records no doubt when the owning provider reports the PTY absent', async () => {
    const runtime = makeRuntimeMissingFromInventory(() => false)

    await runtime.listTerminals(`id:${WORKTREE_ID}`)

    // An observed absence is the death certificate callers already act on.
    expect(runtime.getPtyLivenessVerdict(REMOTE_PTY_ID)).toBeNull()
  })
})
