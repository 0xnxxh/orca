// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DashboardCard } from '../../../../shared/dashboard-snapshot'
import { useFleetResultDisposition } from './use-fleet-result-disposition'

function card(id: string): DashboardCard {
  return {
    paneKey: id,
    ptyId: null,
    agentType: 'codex',
    bucket: 'done',
    dotState: 'done',
    task: '',
    repoId: 'repo',
    worktreeId: 'worktree',
    tabId: `tab-${id}`,
    leafId: null,
    repoName: 'Orca',
    worktreeName: 'Worktree',
    startedAt: 1,
    finishedAt: 2,
    stateChangedAt: 2,
    unseen: true
  }
}

describe('useFleetResultDisposition', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('caps in-memory and persisted pinned pane keys', () => {
    const { result } = renderHook(() => useFleetResultDisposition([], vi.fn()))

    act(() => {
      for (let index = 0; index < 510; index += 1) {
        result.current.togglePinned(card(`pane-${index}`))
      }
    })

    expect(result.current.pinnedPaneKeys.size).toBe(500)
    expect(result.current.pinnedPaneKeys.has('pane-0')).toBe(false)
    expect(result.current.pinnedPaneKeys.has('pane-509')).toBe(true)
    expect(
      JSON.parse(localStorage.getItem('orca.dashboard.map.pinned-pane-keys') ?? '[]')
    ).toHaveLength(500)
  })

  it('caps pane keys loaded from storage', () => {
    localStorage.setItem(
      'orca.dashboard.rings.pinned-pane-keys',
      JSON.stringify(Array.from({ length: 510 }, (_, index) => `stored-${index}`))
    )

    const { result } = renderHook(() => useFleetResultDisposition([], vi.fn()))

    expect(result.current.pinnedPaneKeys.size).toBe(500)
    expect(result.current.pinnedPaneKeys.has('stored-9')).toBe(false)
    expect(result.current.pinnedPaneKeys.has('stored-10')).toBe(true)
    expect(result.current.pinnedPaneKeys.has('stored-509')).toBe(true)
    expect(localStorage.getItem('orca.dashboard.map.pinned-pane-keys')).not.toBeNull()
  })

  it('drops reviewed identities that are absent from the current snapshot', () => {
    const initialCards = Array.from({ length: 600 }, (_, index) => card(`old-${index}`))
    const onAckAgent = vi.fn()
    const { result, rerender } = renderHook(
      ({ cards }: { cards: DashboardCard[] }) => useFleetResultDisposition(cards, onAckAgent),
      { initialProps: { cards: initialCards } }
    )

    act(() => result.current.markReviewed(initialCards))
    expect(result.current.reviewedPaneKeys.size).toBe(600)

    const replacement = [card('replacement')]
    rerender({ cards: replacement })
    expect(result.current.reviewedPaneKeys.size).toBe(0)

    act(() => result.current.markReviewed(replacement))
    expect(result.current.reviewedPaneKeys).toEqual(new Set(['replacement']))
  })
})
