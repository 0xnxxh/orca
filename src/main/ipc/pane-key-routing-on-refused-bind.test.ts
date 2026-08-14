/**
 * Which refusals may re-point a pane key, and what `bindPaneShell` reports about them.
 *
 * `persistPtyBinding` returns false from its compare-and-set paths BEFORE recording a reason —
 * those mean "another pty owns this pane now". Treating that absent reason as stale membership
 * hands the pane key to the LOSER of the race, which flips `isSupersededPtyId` for the winner and
 * silently drops `pty:resize` and `pty:signal` on a live, visible pane.
 *
 * That regression shipped once and 545 tests stayed green, because nothing asserted this gate.
 *
 * Each case uses its OWN leaf, and establishes its starting owner with a SUCCESSFUL bind. The
 * first version of this file leaned on module-level `paneKeyPtyId` residue from the previous test,
 * so the mutation kill vanished under `-t`, `it.only`, or a reordering.
 */
import { describe, expect, it, vi } from 'vitest'
import { bindPaneShell, getPtyIdForPaneKey } from './pty'
import type { Store } from '../persistence'

const WORKTREE = 'wt-1'
const TAB = 'tab-1'

type RefusalReason = 'noTab' | 'noMembership' | undefined
type BindStore = Pick<Store, 'persistPtyBinding' | 'getWorkspaceSession'> &
  Partial<Pick<Store, 'consumePtyBindingRefusalReason'>>

function storeThatBinds(): BindStore {
  return {
    persistPtyBinding: vi.fn(() => true),
    getWorkspaceSession: vi.fn(() => ({}) as ReturnType<Store['getWorkspaceSession']>),
    consumePtyBindingRefusalReason: vi.fn((): RefusalReason => undefined)
  }
}

function storeThatRefuses(reason: RefusalReason): BindStore {
  return {
    persistPtyBinding: vi.fn(() => false),
    getWorkspaceSession: vi.fn(() => ({}) as ReturnType<Store['getWorkspaceSession']>),
    consumePtyBindingRefusalReason: vi.fn((): RefusalReason => reason)
  }
}

function bind(store: BindStore, leafId: string, ptyId: string) {
  return bindPaneShell({ store, worktreeId: WORKTREE, tabId: TAB, leafId, ptyId, mayCreate: false })
}

describe('routing a pane key when the binding write was refused', () => {
  it('re-points the key when the tab is live and only its membership is stale', () => {
    const leafId = '11111111-1111-4111-8111-111111111111'
    expect(bind(storeThatBinds(), leafId, 'pty-original').bound).toBe(true)
    expect(getPtyIdForPaneKey(`${TAB}:${leafId}`)).toBe('pty-original')

    const result = bind(storeThatRefuses('noMembership'), leafId, 'pty-stale-membership')

    expect(result.bound).toBe(false)
    expect(result.refusalReason).toBe('noMembership')
    expect(getPtyIdForPaneKey(`${TAB}:${leafId}`)).toBe('pty-stale-membership')
  })

  // The regression: a lost ownership race records NO reason, and must not re-point the key.
  it('leaves the key alone when no reason was recorded, which means a lost ownership race', () => {
    const leafId = '22222222-2222-4222-8222-222222222222'
    expect(bind(storeThatBinds(), leafId, 'pty-the-winner').bound).toBe(true)

    const result = bind(storeThatRefuses(undefined), leafId, 'pty-the-loser')

    expect(result.bound).toBe(false)
    expect(
      result.refusalReason,
      'a CAS refusal reported a reason it never recorded'
    ).toBeUndefined()
    expect(
      getPtyIdForPaneKey(`${TAB}:${leafId}`),
      'the pane key was handed to the pty that lost the ownership race'
    ).toBe('pty-the-winner')
  })

  // The reason is also what the relay reads to decide whether to publish the pane at all.
  it('reports noTab and leaves the key alone when the pane has no durable tab', () => {
    const leafId = '33333333-3333-4333-8333-333333333333'
    expect(bind(storeThatBinds(), leafId, 'pty-owner').bound).toBe(true)

    const result = bind(storeThatRefuses('noTab'), leafId, 'pty-no-tab')

    expect(result.bound).toBe(false)
    expect(result.refusalReason, 'the relay cannot tell a ghost pane from a stale one').toBe(
      'noTab'
    )
    expect(getPtyIdForPaneKey(`${TAB}:${leafId}`)).toBe('pty-owner')
  })
})
