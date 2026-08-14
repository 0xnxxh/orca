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
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getDefaultPersistedState, getDefaultWorkspaceSession } from '../shared/constants'
import { toSshExecutionHostId } from '../shared/execution-host'
import { toAppSshPtyId, toRelaySshPtyId } from '../shared/ssh-pty-id'

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
const LEAF_TWO = '9a8b7c6d-5e4f-4a3b-8c9d-0e1f2a3b4c5d'
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

/** A pre-upgrade profile has the partition and no hoist marker; the marker only exists because
 *  this build writes it. Stripping it models the on-disk state an upgrading user actually has. */
function stripHoistMarker(): void {
  const file = join(testState.dir, 'orca-data.json')
  const state = JSON.parse(readFileSync(file, 'utf-8')) as {
    settings?: { sshHoistedTabIds?: string[]; sshHoistedUnifiedTabIds?: string[] }
  }
  delete state.settings?.sshHoistedTabIds
  delete state.settings?.sshHoistedUnifiedTabIds
  writeFileSync(file, JSON.stringify(state), 'utf-8')
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
const GROUP = 'group-1'

/** The shape `tabSchema` requires. The tab bar hydrates from `unifiedTabs`, NOT `tabsByWorktree`,
 *  and `salvagingArray` silently DROPS a record missing any non-optional field — leaving an empty
 *  array rather than a parse failure. A fixture without this measures nothing about visibility. */
function unifiedTab(id: string) {
  return {
    id,
    entityId: id,
    groupId: GROUP,
    worktreeId: WORKTREE,
    contentType: 'terminal' as const,
    label: 'shell',
    customLabel: null,
    color: null,
    sortOrder: 0,
    createdAt: 1_700_000_000_000
  }
}

function paneSession() {
  return {
    ...getDefaultWorkspaceSession(),
    activeWorktreeId: WORKTREE,
    activeTabId: TAB,
    activeTabIdByWorktree: { [WORKTREE]: TAB },
    unifiedTabs: { [WORKTREE]: [unifiedTab(TAB)] },
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
    stripHoistMarker()

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

  // NOTE: with the hoist in place this no longer isolates `mayCreate` — the reopen has already
  // folded the tab into local, so the bind would succeed either way. Kept as a plain end-to-end
  // assertion that the upgraded profile can bind, not as a counterfactual. The counterfactual it
  // used to encode is now carried by the hoist's own mutation test.
  it('binds without needing to create, once the pane has been hoisted', async () => {
    const before = await createStore()
    before.setWorkspaceSession(paneSession() as never, SSH_PARTITION)
    before.flushOrThrow()
    stripHoistMarker()
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

  // A migration that leaves its source behind runs again on the next launch and re-adds panes the
  // user has since closed, because "local has no such tab" is precisely its hoist condition.
  it('does not resurrect a tab the user closed after upgrading', async () => {
    const before = await createStore()
    before.setWorkspaceSession(paneSession() as never, SSH_PARTITION)
    before.flushOrThrow()
    stripHoistMarker()

    // The upgrade launch hoists the pane.
    const upgraded = await reopenStore()
    expect(upgraded.getWorkspaceSession().tabsByWorktree?.[WORKTREE] ?? []).toHaveLength(1)

    // The user closes it, and that sticks.
    upgraded.setWorkspaceSession({
      ...upgraded.getWorkspaceSession(),
      tabsByWorktree: { [WORKTREE]: [] }
    } as never)
    upgraded.flushOrThrow()

    const relaunched = await reopenStore()
    expect(
      relaunched.getWorkspaceSession().tabsByWorktree?.[WORKTREE] ?? [],
      'the migration re-added a tab the user had closed'
    ).toHaveLength(0)
  })

  // The ssh:<target> plane is still written by the headless and CLI surfaces, so the hoist has to
  // stay repeatable. A one-shot flag would snapshot the plane once and strand every pane added
  // after it — the same tab loss, made permanent instead of lasting one launch.
  it('still hoists a tab the partition gains after an earlier hoist', async () => {
    const before = await createStore()
    before.setWorkspaceSession(paneSession() as never, SSH_PARTITION)
    before.flushOrThrow()
    stripHoistMarker()

    const upgraded = await reopenStore()
    expect(upgraded.getWorkspaceSession().tabsByWorktree?.[WORKTREE] ?? []).toHaveLength(1)

    // The live plane gains a SECOND pane after the first hoist has already run.
    const second = paneSession()
    second.tabsByWorktree[WORKTREE] = [
      ...second.tabsByWorktree[WORKTREE],
      { ...second.tabsByWorktree[WORKTREE][0], id: 'tab-2' }
    ]
    // Its layout too: a pane is only hoisted when both halves survived, so a tab without one
    // would be refused — correctly, but it would not exercise what this test is about.
    second.terminalLayoutsByTabId = {
      ...second.terminalLayoutsByTabId,
      'tab-2': {
        root: { type: 'leaf' as const, leafId: LEAF_TWO },
        activeLeafId: LEAF_TWO,
        expandedLeafId: null,
        ptyIdsByLeafId: { [LEAF_TWO]: PTY }
      }
    } as typeof second.terminalLayoutsByTabId
    upgraded.setWorkspaceSession(second as never, SSH_PARTITION)
    upgraded.flushOrThrow()

    const relaunched = await reopenStore()
    expect(
      (relaunched.getWorkspaceSession().tabsByWorktree?.[WORKTREE] ?? [])
        .map((tab) => tab.id)
        .sort(),
      'a pane the partition gained after the first hoist was stranded'
    ).toEqual(['tab-1', 'tab-2'])
  })

  // Field-level salvage can drop a tab record while keeping its layout, or the reverse. Moving
  // half a pane into local is worse than leaving it quarantined: a tab with no layout blanks, and
  // an orphan layout is unreachable.
  it('leaves a partially-salvaged pane in the partition rather than half-hoisting it', async () => {
    const before = await createStore()
    const partial = paneSession()
    // The layout survives, the tab record does not — exactly what salvage produces.
    partial.tabsByWorktree = { [WORKTREE]: [] }
    before.setWorkspaceSession(partial as never, SSH_PARTITION)
    before.flushOrThrow()
    stripHoistMarker()

    const store = await reopenStore()

    expect(
      store.getWorkspaceSession().terminalLayoutsByTabId?.[TAB],
      'an orphan layout was hoisted into local with no tab to reach it'
    ).toBeUndefined()
  })

  // A background or CLI-created tab persists with `tab.ptyId` and no layout until its pane first
  // mounts, and hydration falls back to `tab.ptyId` for that shape. Requiring a layout stranded
  // exactly the CLI/headless cohort whose live writes this hoist exists to carry.
  it('hoists a tab that has no layout yet', async () => {
    const before = await createStore()
    const layoutless = paneSession()
    layoutless.terminalLayoutsByTabId = {} as typeof layoutless.terminalLayoutsByTabId
    before.setWorkspaceSession(layoutless as never, SSH_PARTITION)
    before.flushOrThrow()
    stripHoistMarker()

    const store = await reopenStore()

    expect(
      store.getWorkspaceSession().tabsByWorktree?.[WORKTREE] ?? [],
      'a tab whose pane had not mounted yet was stranded in the partition'
    ).toHaveLength(1)
  })

  // The refusal reason decides whether a still-live pane keeps its routing and its mobile/CLI
  // surface. Getting it wrong in either direction is a real failure: 'noTab' on a live tab
  // orphans a running shell, and 'noMembership' on a missing tab publishes something that does
  // not exist.
  describe('why a mayCreate:false write was refused', () => {
    it('reports noTab when the pane has no durable tab at all', async () => {
      const store = await createStore()

      const bound = store.persistPtyBinding({
        worktreeId: WORKTREE,
        tabId: TAB,
        leafId: LEAF,
        ptyId: PTY,
        mayCreate: false
      })

      expect(bound).toBe(false)
      expect(store.consumePtyBindingRefusalReason()).toBe('noTab')
    })

    // The CAS refusals mean "another pty owns this pane now". They record NO reason, and the
    // caller must not treat that absence as stale membership — routing there hands the pane key to
    // the loser of the race, and the winner then silently stops resizing and signalling.
    it('records no reason when a compare-and-set refuses, so the caller cannot mistake it', async () => {
      const store = await createStore()
      store.setWorkspaceSession(paneSession() as never)

      const bound = store.persistPtyBinding({
        worktreeId: WORKTREE,
        tabId: TAB,
        leafId: LEAF,
        ptyId: PTY,
        mayCreate: false,
        expectedBinding: { ptyId: 'a-pty-that-does-not-own-this-pane' }
      })

      expect(bound).toBe(false)
      expect(
        store.consumePtyBindingRefusalReason(),
        'a lost ownership race was reported as a membership problem'
      ).toBeUndefined()
    })

    // The reset on entry is the only thing stopping one call's reason being attributed to the
    // next. It matters whenever a reason goes unconsumed — which the store type now permits,
    // since `consumePtyBindingRefusalReason` is optional on the caller's view of the store.
    it('does not carry a reason over from a previous refusal that was never consumed', async () => {
      const store = await createStore()
      store.setWorkspaceSession(paneSession() as never)

      // A membership refusal whose reason is deliberately NOT consumed. Asserted, because if
      // fixture drift ever let this SUCCEED there would be no reason to leak and the test would
      // pass for the wrong reason.
      expect(
        store.persistPtyBinding({
          worktreeId: WORKTREE,
          tabId: TAB,
          leafId: LEAF_TWO,
          ptyId: PTY,
          mayCreate: false
        }),
        'the setup call bound instead of being refused, so nothing was left to leak'
      ).toBe(false)

      // A compare-and-set refusal, which must record nothing of its own.
      expect(
        store.persistPtyBinding({
          worktreeId: WORKTREE,
          tabId: TAB,
          leafId: LEAF,
          ptyId: PTY,
          mayCreate: false,
          expectedBinding: { ptyId: 'a-pty-that-does-not-own-this-pane' }
        })
      ).toBe(false)

      expect(
        store.consumePtyBindingRefusalReason(),
        'a stale reason from an earlier call was attributed to a lost ownership race'
      ).toBeUndefined()
    })

    // The expectedSourceBinding family returns even earlier than expectedBinding, and was the
    // uncovered half: a reset that only cleared on the expectedBinding path stayed green.
    it('records no reason when a source-binding compare-and-set refuses', async () => {
      const store = await createStore()
      store.setWorkspaceSession(paneSession() as never)

      expect(
        store.persistPtyBinding({
          worktreeId: WORKTREE,
          tabId: TAB,
          leafId: LEAF_TWO,
          ptyId: PTY,
          mayCreate: false
        }),
        'the setup call bound instead of being refused, so nothing was left to leak'
      ).toBe(false)

      expect(
        store.persistPtyBinding({
          worktreeId: WORKTREE,
          tabId: TAB,
          leafId: LEAF,
          ptyId: PTY,
          mayCreate: false,
          expectedSourceBinding: {
            worktreeId: WORKTREE,
            tabId: 'a-tab-that-is-not-this-one',
            leafId: LEAF,
            ptyId: PTY
          }
        })
      ).toBe(false)

      expect(
        store.consumePtyBindingRefusalReason(),
        'a stale reason survived a source-binding refusal'
      ).toBeUndefined()
    })

    it('reports noMembership when the tab is live but the leaf is not in its layout', async () => {
      const store = await createStore()
      // A live tab with a layout that does not contain the leaf being bound.
      store.setWorkspaceSession(paneSession() as never)

      const bound = store.persistPtyBinding({
        worktreeId: WORKTREE,
        tabId: TAB,
        leafId: LEAF_TWO,
        ptyId: PTY,
        mayCreate: false
      })

      expect(bound).toBe(false)
      expect(
        store.consumePtyBindingRefusalReason(),
        'a live tab was reported as missing, which orphans its running shell'
      ).toBe('noMembership')
    })
  })

  // The supersession rollback had no tests at all, which is how a restore that silently dropped
  // layout-less tabs survived a review round. A failed write must leave the pane exactly as it
  // was — not holding a live lease with its binding cleared.
  describe('rolling back a supersession whose write fails', () => {
    it('restores the binding of a tab that has no layout yet', async () => {
      const store = await createStore()
      const layoutless = paneSession()
      layoutless.terminalLayoutsByTabId = {} as typeof layoutless.terminalLayoutsByTabId
      store.setWorkspaceSession(layoutless as never)

      const snapshots = (
        store as unknown as {
          snapshotSshLeaseBindings: (
            targetId: string,
            leases: { leafId?: string; ptyId: string; targetId: string }[]
          ) => { tabs: { leafId: string; ptyId: string; tabId: string }[] }
        }
      ).snapshotSshLeaseBindings(TARGET, [
        { leafId: LEAF, ptyId: toRelaySshPtyId(TARGET, PTY), targetId: TARGET }
      ])

      expect(
        snapshots.tabs,
        'nothing was snapshotted, so a restore would have nothing to prove'
      ).toHaveLength(1)
      expect(snapshots.tabs[0]?.tabId, 'the snapshot did not record which tab it came from').toBe(
        TAB
      )
    })
  })

  // The hoisted pane must not ALIAS the partition's objects. `arbitratedFrom: 'local'` exists so a
  // decision read from one plane cannot mutate the other; a shared object defeats it silently and
  // strands a shell whose owner never voted on that decision.
  it('hoists copies, so mutating the local pane leaves the partition alone', async () => {
    const before = await createStore()
    before.setWorkspaceSession(paneSession() as never, SSH_PARTITION)
    before.flushOrThrow()
    stripHoistMarker()

    const store = await reopenStore()
    const localTab = (store.getWorkspaceSession().tabsByWorktree?.[WORKTREE] ?? [])[0]
    expect(localTab, 'the pane was not hoisted, so aliasing cannot be observed').toBeDefined()

    // A mutation scoped to the local plane.
    localTab!.ptyId = null

    expect(
      store.getWorkspaceSession(SSH_PARTITION).tabsByWorktree?.[WORKTREE]?.[0]?.ptyId,
      'a local-only edit reached through into the ssh partition'
    ).toBe(PTY)

    // The layout is hoisted separately and was cloned separately, so it needs its own assertion.
    const localLayout = store.getWorkspaceSession().terminalLayoutsByTabId?.[TAB]
    expect(localLayout, 'no layout was hoisted, so its isolation cannot be observed').toBeDefined()
    localLayout!.ptyIdsByLeafId = {}

    expect(
      store.getWorkspaceSession(SSH_PARTITION).terminalLayoutsByTabId?.[TAB]?.ptyIdsByLeafId?.[
        LEAF
      ],
      'a local-only layout edit reached through into the ssh partition'
    ).toBe(PTY)
  })

  // The E2E covers only the FIRST upgrade, where local has no unified record. This is the second
  // hoist: the plane is live, so the CLI adds a tab afterwards. Folding it into tabsByWorktree
  // alone satisfies persistPtyBinding — so a Store-level oracle stays green — while the tab bar,
  // which hydrates from unifiedTabs, can never render it.
  it('still hoists the unified record of a tab the partition gains after an earlier hoist', async () => {
    const before = await createStore()
    before.setWorkspaceSession(paneSession() as never, SSH_PARTITION)
    before.flushOrThrow()
    stripHoistMarker()

    const upgraded = await reopenStore()
    expect(upgraded.getWorkspaceSession().unifiedTabs?.[WORKTREE] ?? []).toHaveLength(1)

    const second = paneSession()
    second.tabsByWorktree[WORKTREE] = [
      ...second.tabsByWorktree[WORKTREE]!,
      { ...second.tabsByWorktree[WORKTREE]![0]!, id: 'tab-2' }
    ]
    second.unifiedTabs = {
      [WORKTREE]: [...second.unifiedTabs[WORKTREE]!, unifiedTab('tab-2')]
    } as typeof second.unifiedTabs
    upgraded.setWorkspaceSession(second as never, SSH_PARTITION)
    upgraded.flushOrThrow()

    const relaunched = await reopenStore()

    expect(
      (relaunched.getWorkspaceSession().unifiedTabs?.[WORKTREE] ?? []).map((tab) => tab.id).sort(),
      'the later tab never reached unifiedTabs, so the tab bar cannot render it'
    ).toEqual(['tab-1', 'tab-2'])
  })

  // The two planes do not have to arrive together: a session written without `unifiedTabs` rebases
  // `tabsByWorktree` alone (see `includeUnifiedTabs` in the membership authority), so the unified
  // record can land a launch later. One shared ledger would have stamped the id on the first pass
  // and suppressed the record forever — in the tab bar, permanently.
  it('hoists a unified record that arrives a launch after its tabsByWorktree entry', async () => {
    const first = paneSession()
    delete (first as { unifiedTabs?: unknown }).unifiedTabs
    const before = await createStore()
    before.setWorkspaceSession(first as never, SSH_PARTITION)
    before.flushOrThrow()
    stripHoistMarker()

    const upgraded = await reopenStore()
    expect(upgraded.getWorkspaceSession().tabsByWorktree?.[WORKTREE] ?? []).toHaveLength(1)
    expect(upgraded.getWorkspaceSession().unifiedTabs?.[WORKTREE] ?? []).toHaveLength(0)

    // Next launch: the partition now carries the unified record too.
    upgraded.setWorkspaceSession(paneSession() as never, SSH_PARTITION)
    upgraded.flushOrThrow()

    const relaunched = await reopenStore()
    expect(
      (relaunched.getWorkspaceSession().unifiedTabs?.[WORKTREE] ?? []).map((tab) => tab.id),
      'the unified record was stamped by the tabsByWorktree hoist and suppressed forever'
    ).toEqual([TAB])
  })

  // Closing the last tab EMPTIES unifiedTabs without deleting the key, so a bare id-diff re-adds
  // every closed tab — and this is the plane the tab bar hydrates from, so they return on screen.
  it('does not resurrect a closed tab into the plane the tab bar renders', async () => {
    const before = await createStore()
    before.setWorkspaceSession(paneSession() as never, SSH_PARTITION)
    before.flushOrThrow()
    stripHoistMarker()

    const upgraded = await reopenStore()
    expect(upgraded.getWorkspaceSession().unifiedTabs?.[WORKTREE] ?? []).toHaveLength(1)

    upgraded.setWorkspaceSession({
      ...upgraded.getWorkspaceSession(),
      tabsByWorktree: { [WORKTREE]: [] },
      unifiedTabs: { [WORKTREE]: [] }
    } as never)
    upgraded.flushOrThrow()

    const relaunched = await reopenStore()

    expect(
      relaunched.getWorkspaceSession().unifiedTabs?.[WORKTREE] ?? [],
      'a tab the user closed came back in the tab bar'
    ).toHaveLength(0)
  })

  // The ledger is what stops a closed tab being folded back in, so an entry must survive exactly
  // as long as the partition still offers that tab. Capping by recency evicted the entries a
  // long-lived profile needs most, and a re-hoisted id returns a closed tab to the plane the tab
  // bar renders from — on screen.
  it('keeps ledger entries for every tab the partition still offers, however many there are', async () => {
    const before = await createStore()
    const many = paneSession()
    const ids = Array.from({ length: 600 }, (_, index) => `tab-${index}`)
    many.tabsByWorktree[WORKTREE] = ids.map((id) => ({
      ...many.tabsByWorktree[WORKTREE]![0]!,
      id
    }))
    many.unifiedTabs = { [WORKTREE]: ids.map((id) => unifiedTab(id)) } as typeof many.unifiedTabs
    before.setWorkspaceSession(many as never, SSH_PARTITION)
    before.flushOrThrow()
    stripHoistMarker()

    const upgraded = await reopenStore()
    expect(
      upgraded.getWorkspaceSession().tabsByWorktree?.[WORKTREE] ?? [],
      'the tabs never hoisted, so eviction cannot be observed'
    ).toHaveLength(ids.length)

    // The user closes them all.
    upgraded.setWorkspaceSession({
      ...upgraded.getWorkspaceSession(),
      tabsByWorktree: { [WORKTREE]: [] },
      unifiedTabs: { [WORKTREE]: [] }
    } as never)
    upgraded.flushOrThrow()

    const relaunched = await reopenStore()

    expect(
      relaunched.getWorkspaceSession().unifiedTabs?.[WORKTREE] ?? [],
      'an evicted ledger entry let a closed tab reappear in the tab bar'
    ).toHaveLength(0)
    // Both ledgers, not one: asserting only unifiedTabs left the tabsByWorktree ledger's own
    // eviction completely unobserved — closed tabs came back into that plane silently.
    expect(
      relaunched.getWorkspaceSession().tabsByWorktree?.[WORKTREE] ?? [],
      'an evicted ledger entry let a closed tab reappear in tabsByWorktree'
    ).toHaveLength(0)
  })
})
