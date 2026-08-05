import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDefaultWorkspaceSession } from '../shared/constants'
import type { TerminalTab, WorkspaceSessionState } from '../shared/types'

const testState = { dir: '' }
const LEAF_1 = '11111111-1111-4111-8111-111111111111'
const LEAF_2 = '22222222-2222-4222-8222-222222222222'

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
    decryptString: (value: Buffer) => value.toString().slice('encrypted:'.length)
  }
}))
vi.mock('./ssh/ssh-config-parser', () => ({
  loadUserSshConfig: vi.fn(),
  sshConfigHostsToTargets: vi.fn()
}))
vi.mock('./telemetry/client', () => ({ track: vi.fn() }))
vi.mock('./telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn(() => ({})) }))

async function createStore() {
  vi.resetModules()
  const { Store } = await import('./persistence')
  return new Store({ dataFile: join(testState.dir, 'orca-data.json') })
}

function terminalTab(overrides: Partial<TerminalTab> = {}): TerminalTab {
  return {
    id: 'tab-1',
    worktreeId: 'wt-1',
    title: 'Terminal',
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 1,
    ptyId: 'pty-old',
    ...overrides
  }
}

function sessionWithExistingPane(): WorkspaceSessionState {
  return {
    ...getDefaultWorkspaceSession(),
    tabsByWorktree: { 'wt-1': [terminalTab()] },
    terminalLayoutsByTabId: {
      'tab-1': {
        root: { type: 'leaf', leafId: LEAF_1 },
        activeLeafId: LEAF_1,
        expandedLeafId: null,
        ptyIdsByLeafId: { [LEAF_1]: 'pty-old' }
      }
    },
    terminalTopologyRevisionByRepoId: { 'wt-1': 7 }
  }
}

describe('Store SSH reattach containment', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'orca-ssh-reattach-'))
  })

  afterEach(() => {
    rmSync(testState.dir, { recursive: true, force: true })
  })

  it('refuses every creating bind branch without mutation or flush', async () => {
    const store = await createStore()
    const cases: {
      name: string
      session: WorkspaceSessionState
      tabId: string
      leafId: string
    }[] = [
      {
        name: 'missing tab',
        session: getDefaultWorkspaceSession(),
        tabId: 'tab-missing',
        leafId: LEAF_1
      },
      {
        name: 'missing legacy tab',
        session: getDefaultWorkspaceSession(),
        tabId: 'tab-missing',
        leafId: 'pane:legacy'
      },
      {
        name: 'missing layout',
        session: {
          ...getDefaultWorkspaceSession(),
          tabsByWorktree: { 'wt-1': [terminalTab()] }
        },
        tabId: 'tab-1',
        leafId: LEAF_1
      },
      {
        name: 'empty layout root',
        session: {
          ...getDefaultWorkspaceSession(),
          tabsByWorktree: { 'wt-1': [terminalTab()] },
          terminalLayoutsByTabId: {
            'tab-1': {
              root: null,
              activeLeafId: null,
              expandedLeafId: null,
              ptyIdsByLeafId: {}
            }
          }
        },
        tabId: 'tab-1',
        leafId: LEAF_1
      },
      {
        name: 'missing leaf',
        session: sessionWithExistingPane(),
        tabId: 'tab-1',
        leafId: LEAF_2
      }
    ]
    const flush = vi.spyOn(store, 'flushOrThrow')

    for (const [optionIndex, options] of [
      { mayCreate: false },
      { mayCreate: false, dryRun: true }
    ].entries()) {
      for (const [caseIndex, testCase] of cases.entries()) {
        const hostId = `ssh:test-${optionIndex}-${caseIndex}`
        store.setWorkspaceSession(structuredClone(testCase.session), hostId)
        const before = structuredClone(store.getWorkspaceSession(hostId))
        flush.mockClear()

        const outcome = store.persistPtyBinding(
          {
            worktreeId: 'wt-1',
            tabId: testCase.tabId,
            leafId: testCase.leafId,
            ptyId: 'pty-new',
            incarnationId: 'incarnation-new'
          },
          hostId,
          options
        )

        expect(outcome, testCase.name).toBe('refused')
        expect(store.getWorkspaceSession(hostId), testCase.name).toEqual(before)
        expect(flush, testCase.name).not.toHaveBeenCalled()
      }
    }
  })

  it('dry-runs an existing bind without writing and binds existing-only without topology growth', async () => {
    const store = await createStore()
    store.setWorkspaceSession(sessionWithExistingPane())
    const before = structuredClone(store.getWorkspaceSession())
    const flush = vi.spyOn(store, 'flushOrThrow')

    expect(
      store.persistPtyBinding(
        { worktreeId: 'wt-1', tabId: 'tab-1', leafId: LEAF_1, ptyId: 'pty-new' },
        undefined,
        { mayCreate: false, dryRun: true }
      )
    ).toBe('bound')
    expect(store.getWorkspaceSession()).toEqual(before)
    expect(flush).not.toHaveBeenCalled()

    expect(
      store.persistPtyBinding(
        {
          worktreeId: 'wt-1',
          tabId: 'tab-1',
          leafId: LEAF_1,
          ptyId: 'pty-new',
          incarnationId: 'incarnation-new'
        },
        undefined,
        { mayCreate: false }
      )
    ).toBe('bound')
    expect(store.getWorkspaceSession().terminalLayoutsByTabId['tab-1'].root).toEqual(
      before.terminalLayoutsByTabId['tab-1'].root
    )
    expect(store.getWorkspaceSession().terminalLayoutsByTabId['tab-1'].ptyIdsByLeafId).toEqual({
      [LEAF_1]: 'pty-new'
    })
    expect(store.getWorkspaceSession().terminalTopologyRevisionByRepoId?.['wt-1']).toBe(7)
    expect(flush).toHaveBeenCalledOnce()
  })

  it('rolls back an existing-only bind when its durable flush fails', async () => {
    const store = await createStore()
    store.setWorkspaceSession(sessionWithExistingPane())
    const before = structuredClone(store.getWorkspaceSession())
    vi.spyOn(store, 'flushOrThrow').mockImplementationOnce(() => {
      throw new Error('disk full')
    })

    expect(() =>
      store.persistPtyBinding(
        {
          worktreeId: 'wt-1',
          tabId: 'tab-1',
          leafId: LEAF_1,
          ptyId: 'pty-new',
          incarnationId: 'incarnation-new'
        },
        undefined,
        { mayCreate: false }
      )
    ).toThrow('disk full')
    expect(store.getWorkspaceSession()).toEqual(before)
  })

  it('collapses duplicate panes deterministically and persists the terminal losers', async () => {
    const store = await createStore()
    const timestamps = [
      ['pty-updated-old', 900, 100],
      ['pty-created-old', 100, 200],
      ['pty-a', 300, 200],
      ['pty-z', 300, 200]
    ] as const
    for (const [ptyId, createdAt, updatedAt] of timestamps) {
      store.upsertSshRemotePtyLease({
        targetId: 'target-1',
        ptyId,
        state: 'detached',
        createdAt,
        updatedAt
      })
    }
    store.upsertSshRemotePtyLease({
      targetId: 'target-1',
      ptyId: 'pty-identity-incomplete',
      state: 'detached',
      createdAt: 1,
      updatedAt: 1
    })
    for (const lease of store.getSshRemotePtyLeases('target-1')) {
      if (lease.ptyId !== 'pty-identity-incomplete') {
        Object.assign(lease, { worktreeId: 'wt-1', tabId: 'tab-1', leafId: LEAF_1 })
      }
    }
    store.flush()

    const reloaded = await createStore()
    const collapsed = reloaded.getSshRemotePtyLeases('target-1')
    expect(collapsed.find((lease) => lease.ptyId === 'pty-z')?.state).toBe('detached')
    expect(collapsed.find((lease) => lease.ptyId === 'pty-identity-incomplete')?.state).toBe(
      'detached'
    )
    for (const ptyId of ['pty-updated-old', 'pty-created-old', 'pty-a']) {
      expect(collapsed.find((lease) => lease.ptyId === ptyId)?.state, ptyId).toBe('terminated')
    }

    reloaded.flush()
    const persisted = (await createStore()).getSshRemotePtyLeases('target-1')
    for (const ptyId of ['pty-updated-old', 'pty-created-old', 'pty-a']) {
      expect(persisted.find((lease) => lease.ptyId === ptyId)?.state, ptyId).toBe('terminated')
    }
  })

  it('keeps a duplicate exclusion terminal across source-recovery state writes', async () => {
    const store = await createStore()
    store.upsertSshRemotePtyLease({
      targetId: 'target-1',
      ptyId: 'pty-discarded',
      state: 'attached'
    })
    store.excludeDuplicateSshRemotePtyLeases('target-1', ['pty-discarded'])

    store.markSshRemotePtyLease('target-1', 'pty-discarded', 'detached')
    await store.markSshRemotePtyLeasesAttachedAsync('target-1', ['pty-discarded'])

    expect(store.getSshRemotePtyLeases('target-1')[0]).toEqual(
      expect.objectContaining({ ptyId: 'pty-discarded', state: 'terminated' })
    )
  })
})
