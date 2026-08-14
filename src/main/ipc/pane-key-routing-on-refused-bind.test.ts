/**
 * Which refusals may re-point a pane key.
 *
 * `persistPtyBinding` returns false from its compare-and-set paths BEFORE recording a reason —
 * those mean "another pty owns this pane now". Treating that absent reason as stale membership
 * hands the pane key to the LOSER of the race, which flips `isSupersededPtyId` for the winner and
 * silently drops `pty:resize` and `pty:signal` on a live, visible pane.
 *
 * That regression shipped once and 545 tests stayed green, because nothing asserted this gate.
 */
import { describe, expect, it, vi } from 'vitest'
import { bindPaneShell, getPtyIdForPaneKey } from './pty'

const WORKTREE = 'wt-1'
const TAB = 'tab-1'
const LEAF = '3f1c9a2e-7b4d-4e1a-9c8f-2d5e6a7b8c90'
const PANE_KEY = `${TAB}:${LEAF}`

function storeThatRefuses(reason: 'noTab' | 'noMembership' | undefined) {
  return {
    persistPtyBinding: vi.fn(() => false),
    getWorkspaceSession: vi.fn(() => ({}) as never),
    consumePtyBindingRefusalReason: vi.fn(() => reason)
  }
}

describe('routing a pane key when the binding write was refused', () => {
  it('re-points the key when the tab is live and only its membership is stale', () => {
    bindPaneShell({
      store: storeThatRefuses('noMembership') as never,
      worktreeId: WORKTREE,
      tabId: TAB,
      leafId: LEAF,
      ptyId: 'pty-stale-membership',
      mayCreate: false
    })

    expect(getPtyIdForPaneKey(PANE_KEY)).toBe('pty-stale-membership')
  })

  // The regression: a lost ownership race records NO reason, and must not re-point the key.
  it('leaves the key alone when no reason was recorded, which means a lost ownership race', () => {
    bindPaneShell({
      store: storeThatRefuses('noMembership') as never,
      worktreeId: WORKTREE,
      tabId: TAB,
      leafId: LEAF,
      ptyId: 'pty-the-winner',
      mayCreate: false
    })
    expect(getPtyIdForPaneKey(PANE_KEY)).toBe('pty-the-winner')

    bindPaneShell({
      store: storeThatRefuses(undefined) as never,
      worktreeId: WORKTREE,
      tabId: TAB,
      leafId: LEAF,
      ptyId: 'pty-the-loser',
      mayCreate: false
    })

    expect(
      getPtyIdForPaneKey(PANE_KEY),
      'the pane key was handed to the pty that lost the ownership race'
    ).toBe('pty-the-winner')
  })

  it('leaves the key alone when the pane has no durable tab', () => {
    bindPaneShell({
      store: storeThatRefuses('noMembership') as never,
      worktreeId: WORKTREE,
      tabId: TAB,
      leafId: LEAF,
      ptyId: 'pty-owner',
      mayCreate: false
    })

    bindPaneShell({
      store: storeThatRefuses('noTab') as never,
      worktreeId: WORKTREE,
      tabId: TAB,
      leafId: LEAF,
      ptyId: 'pty-no-tab',
      mayCreate: false
    })

    expect(getPtyIdForPaneKey(PANE_KEY)).toBe('pty-owner')
  })
})
