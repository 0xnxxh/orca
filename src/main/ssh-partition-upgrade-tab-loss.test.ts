/**
 * The upgrade case the two reverts kept missing.
 *
 * A user whose SSH pane membership was persisted into `workspaceSessionsByHostId["ssh:<target>"]`
 * carries that state into a build whose reattach bind reads `local` and refuses to create
 * (`mayCreate: false`). Nothing hoists the partition across, so `local` has no tab, the creating
 * branch fires, and the refusal rolls the binding back — for every pane. That is "all tabs gone,
 * survivors blank", and no oracle covered it because every test writes both planes consistently.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getDefaultPersistedState, getDefaultWorkspaceSession } from '../shared/constants'
import { toSshExecutionHostId } from '../shared/execution-host'
import { toAppSshPtyId } from '../shared/ssh-pty-id'

const testState = { dir: '' }

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('./telemetry/client', () => ({ track: vi.fn() }))
vi.mock('./telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn() }))

const TARGET = 'ssh-target-1'
const SSH_PARTITION = toSshExecutionHostId(TARGET)
const WORKTREE = 'repo-1:wt-1'
const TAB = 'tab-1'
const LEAF = '3f1c9a2e-7b4d-4e1a-9c8f-2d5e6a7b8c90'
const PTY = toAppSshPtyId(TARGET, 'pty-1')

async function createStore(state: Record<string, unknown> = {}) {
  mkdirSync(testState.dir, { recursive: true })
  writeFileSync(
    join(testState.dir, 'orca-data.json'),
    JSON.stringify({ ...getDefaultPersistedState(testState.dir), ...state }),
    'utf-8'
  )
  vi.resetModules()
  const { Store, initDataPath } = await import('./persistence')
  initDataPath()
  return new Store()
}

/** Reopen the SAME profile — the upgrade launch. The hoist migration runs at load, so a test that
 *  writes the partition into an already-loaded store would never exercise it. */
async function reopenStore() {
  vi.resetModules()
  const { Store, initDataPath } = await import('./persistence')
  initDataPath()
  return new Store()
}

/** One SSH pane, exactly as the partitioned build persisted it. */
function paneSession() {
  return {
    ...getDefaultWorkspaceSession(),
    activeWorktreeId: WORKTREE,
    activeTabId: TAB,
    activeTabIdByWorktree: { [WORKTREE]: TAB },
    tabsByWorktree: {
      [WORKTREE]: [
        {
          id: TAB,
          worktreeId: WORKTREE,
          title: 'shell',
          ptyId: PTY,
          customTitle: null,
          color: null,
          sortOrder: 0,
          createdAt: 1_700_000_000_000
        }
      ]
    },
    terminalLayoutsByTabId: {
      [TAB]: {
        root: { type: 'leaf' as const, leafId: LEAF },
        activeLeafId: LEAF,
        expandedLeafId: null,
        ptyIdsByLeafId: { [LEAF]: PTY }
      }
    }
  }
}

describe('an SSH pane whose membership was persisted into the ssh partition', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'orca-ssh-partition-upgrade-'))
  })

  it('is still bound on reattach after upgrading to a build that reads local', async () => {
    // The old build: pane membership written into the ssh partition, nothing in local.
    const before = await createStore()
    before.setWorkspaceSession(paneSession() as never, SSH_PARTITION)
    expect(
      before.getWorkspaceSession(SSH_PARTITION).tabsByWorktree?.[WORKTREE],
      'the ssh partition never received the pane, so this proves nothing'
    ).toHaveLength(1)
    expect(before.getWorkspaceSession().tabsByWorktree?.[WORKTREE] ?? []).toHaveLength(0)
    before.flushOrThrow()

    // The upgrade launch.
    const store = await reopenStore()
    // The migration must have folded the pane into the plane the binder actually reads.
    expect(
      store.getWorkspaceSession().tabsByWorktree?.[WORKTREE] ?? [],
      'the migration did not hoist the pane into the local session'
    ).toHaveLength(1)

    // The reattach bind: no hostId, refuses to create.
    const bound = store.persistPtyBinding({
      worktreeId: WORKTREE,
      tabId: TAB,
      leafId: LEAF,
      ptyId: PTY,
      mayCreate: false
    })

    expect(
      bound,
      'reattach refused the pane, so its tab is discarded and the shell is stranded'
    ).toBe(true)
  })

  // The counterfactual that makes this a REGRESSION rather than a standing limitation: before
  // `mayCreate` existed, the same state re-created the tab instead of discarding it. That is what
  // "before, many of the tabs were retained" described — they were being recreated.
  it('was recreated rather than discarded before the refusal was introduced', async () => {
    const before = await createStore()
    before.setWorkspaceSession(paneSession() as never, SSH_PARTITION)
    before.flushOrThrow()
    const store = await reopenStore()

    const bound = store.persistPtyBinding({
      worktreeId: WORKTREE,
      tabId: TAB,
      leafId: LEAF,
      ptyId: PTY
    })

    expect(bound, 'the pre-mayCreate path did not keep the pane either').toBe(true)
  })

  // Isolates the migration from its wiring: does the function itself hoist?
  it('hoists the partition when called directly', async () => {
    await createStore()
    const { hoistSshPartitionsIntoLocalSession } = await import('./persistence')
    const state = {
      workspaceSession: { ...getDefaultWorkspaceSession() },
      workspaceSessionsByHostId: { [SSH_PARTITION]: paneSession() }
    } as never as Parameters<typeof hoistSshPartitionsIntoLocalSession>[0]

    const changed = hoistSshPartitionsIntoLocalSession(state)

    expect(changed, 'the function reported no change').toBe(true)
    expect(state.workspaceSession?.tabsByWorktree?.[WORKTREE] ?? []).toHaveLength(1)
  })
})
