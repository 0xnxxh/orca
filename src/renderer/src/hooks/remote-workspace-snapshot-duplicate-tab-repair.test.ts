/**
 * Regression: a direct-SSH snapshot apply can leave one tab id under two
 * worktree keys, and the active-terminal repair effect must still converge.
 *
 * The remote session is keyed by worktree *path*, so every apply re-resolves it
 * against the current catalog. Rename the worktree on the host (or re-add the
 * repo, which mints a fresh id) and the remote's tabs land under the new
 * worktree id while `replaceHydratedRecordKeys` retains the old key verbatim —
 * nothing de-dupes across keys. This drives that from real hydration rather
 * than constructing the duplicate by hand.
 *
 * ---------------------------------------------------------------------------
 * This test pins convergence. It does NOT run React. The link from "the repair
 * never converges" to "React #185 in the terminal workbench" was closed by a
 * separate end-to-end run, recorded here because the *method* is the part worth
 * keeping — the harness itself is not in the repo (see the last paragraph).
 * Full write-up: PR #11950.
 *
 * That run mounts this same hydrated store under the real production
 * `react-dom` bundle with no `act()` anywhere, and lets React's own scheduler
 * drive the cascade. The production bundle is reached WITHOUT patching
 * `node_modules` — `process.env.NODE_ENV = 'production'` in a side-effect module
 * imported before `react-dom/client` is enough, since ESM evaluates imports in
 * source order. The run asserts it got there rather than assuming:
 * `String(createRoot).includes('formatProdErrorMessage')`.
 *
 * Verbatim, on unfixed origin/main:
 *
 *   E2E driver-only     {"bundleIsProduction":true,
 *                        "owners":["repoA::/srv/proj/wt","repoA::/srv/proj/wt-renamed"],
 *                        "renders":54,"activeTabId":null,
 *                        "captured":[{"source":"window","message":"Minified React error #185; ..."}]}
 *
 *   E2E with-descendant {... "renders":54,"activeTabId":null,
 *                        "frames":["getRootForUpdatedFiber","enqueueConcurrentHookUpdate",
 *                                  "dispatchSetStateInternal","dispatchSetState",
 *                                  "commitHookEffectListMount","commitPassiveMountOnFiber", ...]}
 *
 * The six frames in the second run match all 13 production crash reports, in
 * order. The difference between the two runs is one passenger component that
 * mirrors store state into local `useState` in a passive effect. So: the
 * component that *throws* #185 is not the component *driving* the loop, and a
 * `useState`-shaped stack does not rule out a `useSyncExternalStore` driver.
 * Control, on the fix branch: same passenger, `renders: 2`, nothing captured —
 * it settles when the loop it rides on settles, so it cannot be the driver.
 *
 * Note `owners` is identical in the red and green runs. The fix stops the owner
 * resolver being fooled by the duplicate; it does not remove the duplicate. That
 * is a stated limitation of PR #11950, not an oversight, and it is why this test
 * asserts the duplicate is *produced* and never that it is cleaned up.
 *
 * Why the harness is not committed: it sets `NODE_ENV` process-wide, which leaks
 * to every other test sharing the vitest worker. Reproducing it needs an
 * isolated config, so it was deliberately left as PR evidence.
 */
import { describe, expect, it, vi } from 'vitest'
import type * as AgentStatusModule from '@/lib/agent-status'
import type { RemoteWorkspaceSnapshot } from '../../../shared/remote-workspace-types'
import type { DirectSshAuthority } from '../../../shared/ssh-types'
import { createTestStore, makeWorktree } from '../store/slices/store-test-helpers'
import { applyDirectSshRemoteWorkspaceSnapshot } from './remote-workspace-snapshot-apply'
import type { DirectSshSnapshotApplyToken } from './direct-ssh-reconnect-coordinator-types'
import { resolveRepairedActiveTerminalTabId } from '../components/terminal/active-terminal-repair'

vi.mock('sonner', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/agent-status', async (importOriginal) => {
  const actual = await importOriginal<typeof AgentStatusModule>()
  return { ...actual, detectAgentStatusFromTitle: vi.fn().mockReturnValue(null) }
})

const TARGET_ID = 'ssh-target-1'
const OLD_PATH = '/srv/proj/wt'
const NEW_PATH = '/srv/proj/wt-renamed'
const OLD_ID = `repoA::${OLD_PATH}`
const NEW_ID = `repoA::${NEW_PATH}`
// Why a cap and not a while(true): on unfixed code this cycle never terminates.
const MAX_REPAIR_PASSES = 200

const authority: DirectSshAuthority = {
  targetId: TARGET_ID,
  providerEpoch: { generation: 1, restartCount: 0 } as never,
  connectionGeneration: 1
}

function token(snapshotRevision: number): DirectSshSnapshotApplyToken {
  return {
    authority,
    catalogRevision: 0,
    repoFingerprint: 'fp',
    authorityRequirement: 'required' as never,
    snapshotRevision,
    outcome: 'complete'
  }
}

function snapshot(
  revision: number,
  worktreePath: string,
  tabIds: readonly string[],
  activeTabId: string | null
): RemoteWorkspaceSnapshot {
  return {
    revision,
    updatedAt: revision,
    session: {
      activeWorktreePath: worktreePath,
      activeTabId,
      tabsByWorktreePath: {
        [worktreePath]: tabIds.map((tabId, index) => ({
          id: tabId,
          worktreePath,
          ptyId: `pty-${tabId}`,
          title: `Terminal ${index + 1}`,
          customTitle: null,
          color: null,
          sortOrder: index,
          createdAt: index + 1
        }))
      },
      terminalLayoutsByTabId: {},
      activeWorktreePathsOnShutdown: [],
      activeTabIdByWorktreePath: { [worktreePath]: activeTabId },
      remoteSessionIdsByTabId: Object.fromEntries(tabIds.map((id) => [id, `pty-${id}`])),
      lastVisitedAtByWorktreePath: { [worktreePath]: revision },
      defaultTerminalTabsAppliedByWorktreePath: { [worktreePath]: true }
    }
  } as unknown as RemoteWorkspaceSnapshot
}

type TestStore = ReturnType<typeof createTestStore>

async function applySnapshot(store: TestStore, snap: RemoteWorkspaceSnapshot): Promise<void> {
  await applyDirectSshRemoteWorkspaceSnapshot({
    store,
    snapshot: snap,
    token: token(snap.revision),
    arrival: 1,
    isArrivalCurrent: () => true,
    isPreparationTokenCurrent: () => true,
    waitForWorkspaceSessionReady: async () => true,
    finalizeHydratedTerminals: () => 0
  })
}

function worktreeIdsOwningTab(store: TestStore, tabId: string): string[] {
  return Object.entries(store.getState().tabsByWorktree)
    .filter(([, tabs]) => tabs.some((tab) => tab.id === tabId))
    .map(([worktreeId]) => worktreeId)
}

function seedCatalog(store: TestStore, worktreePath: string): void {
  store.setState({
    worktreesByRepo: {
      repoA: [
        makeWorktree({
          id: `repoA::${worktreePath}`,
          repoId: 'repoA',
          path: worktreePath,
          hostId: `ssh:${TARGET_ID}`
        } as never)
      ]
    }
  })
}

/**
 * One turn of the loop in Terminal.tsx's active-terminal repair effect:
 * recompute the repaired id from live state, then activate it. Reports how many
 * turns it took to stop and how often `activeTabIdByWorktree` — a declared dep
 * of that effect, so a fresh identity re-runs it — was reallocated.
 */
function runRepairCycle(store: TestStore): {
  converged: boolean
  passes: number
  depIdentityChurn: number
} {
  let passes = 0
  let depIdentityChurn = 0
  for (; passes < MAX_REPAIR_PASSES; passes += 1) {
    const live = store.getState()
    const activeWorktreeId = live.activeWorktreeId
    const repairedTabId = resolveRepairedActiveTerminalTabId({
      activeTabType: 'terminal',
      activeTabId: live.activeTabId,
      rememberedTabId: activeWorktreeId
        ? (live.activeTabIdByWorktree[activeWorktreeId] ?? null)
        : null,
      tabs: activeWorktreeId ? (live.tabsByWorktree[activeWorktreeId] ?? []) : []
    })
    if (!repairedTabId) {
      return { converged: true, passes, depIdentityChurn }
    }
    const depsBefore = live.activeTabIdByWorktree
    live.setActiveTab(repairedTabId)
    if (store.getState().activeTabIdByWorktree !== depsBefore) {
      depIdentityChurn += 1
    }
  }
  return { converged: false, passes, depIdentityChurn }
}

describe('direct-SSH snapshot apply, tab id owned by two worktrees', () => {
  it('converges the active-terminal repair instead of re-running it forever', async () => {
    const store = createTestStore()

    store.setState({
      repos: [
        {
          id: 'repoA',
          path: '/srv/proj',
          displayName: 'Proj',
          badgeColor: '#000',
          addedAt: 0,
          connectionId: TARGET_ID
        } as never
      ],
      // Load-bearing, do not drop: the IPC attach is the only thing stubbed, and
      // it leaves behind exactly what a real reconnect leaves behind — one
      // registered live PTY per tab. Without that the orphan sweep on the next
      // worktree visit treats the duplicated tab as dead, cleans it up, and the
      // bug evaporates before the repair effect ever sees it.
      reconnectPersistedTerminals: (async () => {
        const live = store.getState()
        const registered: Record<string, string[]> = { ...live.ptyIdsByTabId }
        for (const tabs of Object.values(live.tabsByWorktree)) {
          for (const tab of tabs) {
            registered[tab.id] = [`pty-${tab.id}`]
          }
        }
        store.setState({ ptyIdsByTabId: registered })
      }) as never,
      markRemoteWorkspaceHydrated: (() => {}) as never,
      setRemoteWorkspaceSyncStatus: (() => {}) as never
    })

    seedCatalog(store, OLD_PATH)
    await applySnapshot(store, snapshot(1, OLD_PATH, ['tab-1', 'tab-2'], 'tab-1'))
    store.getState().setActiveWorktree(OLD_ID)

    // The worktree is renamed on the host; the catalog re-detects it at the new
    // path, so the worktree id changes while the tab ids do not.
    seedCatalog(store, NEW_PATH)
    await applySnapshot(store, snapshot(2, NEW_PATH, ['tab-1', 'tab-2'], 'tab-1'))
    store.getState().setActiveWorktree(NEW_ID)

    // The remote deselects; importRemoteWorkspaceSession nulls an activeTabId it
    // cannot find among the imported tabs, which is what arms the repair effect.
    await applySnapshot(store, snapshot(3, NEW_PATH, ['tab-1', 'tab-2'], null))

    // Why assert the precondition and not its removal: the fix stops the owner
    // resolver being fooled by the duplicate, it does not remove the duplicate.
    // Pinned so the test cannot pass vacuously if hydration stops producing one.
    expect(worktreeIdsOwningTab(store, 'tab-1')).toEqual([OLD_ID, NEW_ID])
    expect(store.getState().activeTabId).toBeNull()

    const repair = runRepairCycle(store)

    expect(repair.converged).toBe(true)
    expect(repair.passes).toBeLessThanOrEqual(store.getState().tabsByWorktree[NEW_ID].length)
    expect(store.getState().activeTabId).toBe('tab-1')

    // The dep identity settles: re-running the effect body after convergence
    // reallocates nothing, so the effect does not schedule itself again.
    const settled = runRepairCycle(store)
    expect(settled.depIdentityChurn).toBe(0)
    expect(settled.passes).toBe(0)
  })
})
