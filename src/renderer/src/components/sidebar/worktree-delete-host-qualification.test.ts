/**
 * STA-4448, end to end from the sidebar: the exact reported user path.
 *
 *   1. The same repo sits at the same path on two hosts, so both publish the id
 *      `repoId::path`. The sidebar's id-keyed projection keeps ONE row for it.
 *   2. The user OPENS the local workspace, which sets `activeWorktreeId`.
 *   3. The user deletes the sidebar row, which belongs to the SSH host.
 *   4. Before this fix, removal routing short-circuited to the ACTIVE host and
 *      destroyed the LOCAL checkout and its uncommitted work.
 *
 * This drives the real sidebar funnel (`runWorktreeDelete` /
 * `runWorktreeDeletesInParallel`) into the real store action, so it covers the
 * caller carrying the confirmed host as well as the chokepoint enforcing it. The
 * only fakes are the removal transports, and they ACTUALLY delete the temp
 * directory of the host they are routed to — see the shared fixture.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import type { AppState } from '@/store/types'
import type { Worktree } from '../../../../shared/worktree/types'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import { makeWorktree } from '@/store/slices/worktrees-slice-test-fixtures'
import {
  createTestStore,
  mockApi,
  resetRemoteRuntimeMocks,
  resetWorktreeSliceModuleMemory,
  runtimeEnvironmentCall
} from '@/store/slices/worktrees-slice-test-harness'
import {
  cleanupHostCheckouts,
  createHostCheckout,
  installRemovalTransports,
  COLLIDING_WORKTREE_ID as WORKTREE_ID,
  COLLIDING_WORKTREE_PATH as WORKTREE_PATH,
  HOST_COLLISION_MESSAGE,
  LOCAL_HOST,
  SSH_HOST
} from '@/store/slices/worktree-removal-host-collision-fixture'

const storeRef = vi.hoisted(() => ({ current: null as unknown as { getState: () => AppState } }))

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => storeRef.current.getState()
  }
}))

vi.mock('sonner', () => ({
  toast: {
    warning: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    dismiss: vi.fn()
  }
}))

vi.mock('@/lib/worktree-activation', () => ({ activateAndRevealWorktree: vi.fn() }))

vi.mock('./delete-worktree-failure-toast', () => ({
  showDeleteWorktreeFailureToast: vi.fn()
}))

import { showDeleteWorktreeFailureToast } from './delete-worktree-failure-toast'
import { runWorktreeDelete, runWorktreeDeletesInParallel } from './delete-worktree-flow'

function failureToastCount(): number {
  return vi.mocked(showDeleteWorktreeFailureToast).mock.calls.length
}

function rowOnHost(hostId: ExecutionHostId): Worktree {
  return makeWorktree({
    id: WORKTREE_ID,
    repoId: 'repo1',
    path: WORKTREE_PATH,
    displayName: 'shared-workspace',
    instanceId: `instance-${hostId}`,
    hostId
  })
}

/**
 * Seeds both hosts' rows for the colliding id. `worktreesByRepo` order matters:
 * the sidebar's id-keyed projection keeps the LAST row, and that is the row the
 * user sees and deletes.
 */
function seedCollidingSidebar(
  store: ReturnType<typeof createTestStore>,
  displayedRowHostId: ExecutionHostId
): void {
  const otherHostId = displayedRowHostId === LOCAL_HOST ? SSH_HOST : LOCAL_HOST
  store.setState({
    repos: [{ id: 'repo1', path: '/repo1', displayName: 'Repo 1', executionHostId: LOCAL_HOST }],
    worktreesByRepo: { repo1: [rowOnHost(otherHostId), rowOnHost(displayedRowHostId)] },
    // The user opened the LOCAL workspace, so removal routing prefers local.
    activeWorktreeId: WORKTREE_ID,
    activeWorkspaceExecutionHostId: LOCAL_HOST,
    activeView: 'terminal',
    activePendingCreationId: null,
    settings: { skipDeleteWorktreeConfirm: true },
    sshConnectionStates: new Map([['ssh-1', { targetId: 'ssh-1', status: 'connected' }]]),
    sshTargetLabels: new Map([['ssh-1', 'SSH One']]),
    worktreeLineageById: {}
  } as unknown as Partial<AppState>)
}

beforeEach(() => {
  vi.clearAllMocks()
  resetRemoteRuntimeMocks()
  resetWorktreeSliceModuleMemory()
  storeRef.current = createTestStore()
})

afterEach(cleanupHostCheckouts)

describe('STA-4448 sidebar delete: the confirmed row decides the host', () => {
  it('leaves the ACTIVE local checkout on disk when the SSH row is deleted', async () => {
    const local = createHostCheckout(LOCAL_HOST)
    const ssh = createHostCheckout(SSH_HOST)
    const routedHostIds: string[] = []
    installRemovalTransports(
      { remove: mockApi.worktrees.remove, runtimeCall: runtimeEnvironmentCall },
      { [LOCAL_HOST]: local.root, [SSH_HOST]: ssh.root },
      routedHostIds
    )
    const store = storeRef.current as ReturnType<typeof createTestStore>
    seedCollidingSidebar(store, SSH_HOST)

    // Right-click the sidebar row → Delete Workspace (confirmation skipped).
    runWorktreeDelete(WORKTREE_ID)
    // Settle on either outcome so the disk assertion below is what reports a
    // regression, rather than a spy that was never reached.
    await vi.waitFor(() => expect(routedHostIds.length + failureToastCount()).toBeGreaterThan(0))

    expect(
      fs.existsSync(local.markerPath),
      `the ACTIVE local checkout must survive deleting the SSH row; removal was routed to hostId=${routedHostIds.join(',') || '<none>'}`
    ).toBe(true)
    // Fail closed, do not reroute: rerouting the colliding row is #14606's job.
    expect(fs.existsSync(ssh.markerPath)).toBe(true)
    expect(routedHostIds).toEqual([])
    expect(vi.mocked(showDeleteWorktreeFailureToast).mock.calls[0]?.[0]).toMatchObject({
      error: HOST_COLLISION_MESSAGE,
      canForceDelete: false
    })
    // The row survives the refusal, so the user can still act on it.
    expect(store.getState().worktreesByRepo.repo1).toHaveLength(2)
  })

  it('leaves the ACTIVE local checkout on disk through the batch delete path', async () => {
    const local = createHostCheckout(LOCAL_HOST)
    const ssh = createHostCheckout(SSH_HOST)
    const routedHostIds: string[] = []
    installRemovalTransports(
      { remove: mockApi.worktrees.remove, runtimeCall: runtimeEnvironmentCall },
      { [LOCAL_HOST]: local.root, [SSH_HOST]: ssh.root },
      routedHostIds
    )
    const store = storeRef.current as ReturnType<typeof createTestStore>
    seedCollidingSidebar(store, SSH_HOST)

    const deletedIds = await runWorktreeDeletesInParallel([rowOnHost(SSH_HOST)], { force: true })

    expect(
      fs.existsSync(local.markerPath),
      `the ACTIVE local checkout must survive a batch delete of the SSH row; removal was routed to hostId=${routedHostIds.join(',') || '<none>'}`
    ).toBe(true)
    expect(fs.existsSync(ssh.markerPath)).toBe(true)
    expect(routedHostIds).toEqual([])
    expect(deletedIds).toEqual([])
  })

  it('still deletes the local checkout for real when the local row is the one deleted', async () => {
    const local = createHostCheckout(LOCAL_HOST)
    const ssh = createHostCheckout(SSH_HOST)
    const routedHostIds: string[] = []
    installRemovalTransports(
      { remove: mockApi.worktrees.remove, runtimeCall: runtimeEnvironmentCall },
      { [LOCAL_HOST]: local.root, [SSH_HOST]: ssh.root },
      routedHostIds
    )
    const store = storeRef.current as ReturnType<typeof createTestStore>
    seedCollidingSidebar(store, LOCAL_HOST)

    runWorktreeDelete(WORKTREE_ID)
    await vi.waitFor(() => expect(routedHostIds).toEqual([LOCAL_HOST]))

    // Confirming the row that IS the active local host deletes it, as asked.
    expect(fs.existsSync(local.markerPath)).toBe(false)
    expect(fs.existsSync(ssh.markerPath)).toBe(true)
    expect(showDeleteWorktreeFailureToast).not.toHaveBeenCalled()
  })

  it('still deletes an ordinary single-host SSH workspace for real', async () => {
    const ssh = createHostCheckout(SSH_HOST)
    const routedHostIds: string[] = []
    installRemovalTransports(
      { remove: mockApi.worktrees.remove, runtimeCall: runtimeEnvironmentCall },
      { [SSH_HOST]: ssh.root },
      routedHostIds
    )
    const store = storeRef.current as ReturnType<typeof createTestStore>
    store.setState({
      repos: [
        {
          id: 'repo1',
          path: '/repo1',
          displayName: 'Repo 1',
          executionHostId: SSH_HOST,
          connectionId: 'ssh-1'
        }
      ],
      worktreesByRepo: { repo1: [rowOnHost(SSH_HOST)] },
      activeWorktreeId: null,
      activeView: 'terminal',
      activePendingCreationId: null,
      settings: { skipDeleteWorktreeConfirm: true },
      sshConnectionStates: new Map([['ssh-1', { targetId: 'ssh-1', status: 'connected' }]]),
      sshTargetLabels: new Map([['ssh-1', 'SSH One']]),
      worktreeLineageById: {}
    } as unknown as Partial<AppState>)

    runWorktreeDelete(WORKTREE_ID)
    await vi.waitFor(() => expect(routedHostIds).toEqual([SSH_HOST]))

    expect(fs.existsSync(ssh.markerPath)).toBe(false)
    expect(showDeleteWorktreeFailureToast).not.toHaveBeenCalled()
  })
})
