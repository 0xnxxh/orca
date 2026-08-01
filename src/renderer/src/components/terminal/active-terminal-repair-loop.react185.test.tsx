/** @vitest-environment happy-dom */
import { act, useEffect, useMemo } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { useAppStore } from '@/store'
import type { TerminalTab } from '../../../../shared/types'
import { resolveRepairedActiveTerminalTabId } from './active-terminal-repair'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Why: React throws #185 at 51 nested commits; 400 proves divergence, not slowness.
const MAX_PASSES = 400

function terminalTab(id: string, worktreeId: string): TerminalTab {
  return { id, worktreeId, title: id, createdAt: 0, sortOrder: 0 } as unknown as TerminalTab
}

/** Mirrors the active-terminal repair effect in Terminal.tsx (same deps, same store call). */
function RepairEffectHarness({ onPass }: { onPass: () => boolean }): null {
  const activeTabId = useAppStore((s) => s.activeTabId)
  const activeTabIdByWorktree = useAppStore((s) => s.activeTabIdByWorktree)
  const activeTabType = useAppStore((s) => s.activeTabType)
  const tabsByWorktree = useAppStore((s) => s.tabsByWorktree)
  const renderedActiveWorktreeId = useAppStore((s) => s.activeWorktreeId)
  const setActiveTab = useAppStore((s) => s.setActiveTab)
  const tabs = useMemo(
    () => (renderedActiveWorktreeId ? (tabsByWorktree[renderedActiveWorktreeId] ?? []) : []),
    [renderedActiveWorktreeId, tabsByWorktree]
  )

  useEffect(() => {
    if (!onPass()) {
      return
    }
    const rememberedTabId = renderedActiveWorktreeId
      ? (activeTabIdByWorktree[renderedActiveWorktreeId] ?? null)
      : null
    const repairedTabId = resolveRepairedActiveTerminalTabId({
      activeTabType,
      activeTabId,
      rememberedTabId,
      tabs
    })
    if (!repairedTabId) {
      return
    }
    setActiveTab(repairedTabId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeTabId,
    activeTabType,
    setActiveTab,
    tabs,
    activeTabIdByWorktree,
    renderedActiveWorktreeId
  ])
  return null
}

let cleanup: (() => void) | null = null

afterEach(() => {
  cleanup?.()
  cleanup = null
})

function measureRepairPasses(): number {
  let passes = 0
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  cleanup = () => {
    act(() => root.unmount())
    container.remove()
  }
  act(() => {
    root.render(<RepairEffectHarness onPass={() => (passes += 1) <= MAX_PASSES} />)
  })
  return passes
}

describe('active-terminal repair effect cannot drive a React #185 update loop', () => {
  it('settles when the repaired tab is owned by the active worktree', () => {
    useAppStore.setState({
      activeWorktreeId: 'wt-active',
      activeTabType: 'terminal',
      activeTabId: 'stale-tab',
      activeTabIdByWorktree: {},
      tabsByWorktree: { 'wt-active': [terminalTab('t1', 'wt-active')] },
      unifiedTabsByWorktree: {}
    })
    expect(measureRepairPasses()).toBeLessThan(10)
    expect(useAppStore.getState().activeTabId).toBe('t1')
  })

  it('settles when another worktree reuses the tab id and is scanned first', () => {
    // Why: setActiveTab attributes a tab to the first worktree whose array holds
    // the id, so a reused id makes it skip the activeTabId write while still
    // reallocating activeTabIdByWorktree — the repair effect's own dependency.
    useAppStore.setState({
      activeWorktreeId: 'wt-active',
      activeTabType: 'terminal',
      activeTabId: 'stale-tab',
      activeTabIdByWorktree: {},
      tabsByWorktree: {
        'wt-other': [terminalTab('t1', 'wt-other')],
        'wt-active': [terminalTab('t1', 'wt-active')]
      },
      unifiedTabsByWorktree: {}
    })
    expect(measureRepairPasses()).toBeLessThan(10)
    // Why: settling by refusing to write would leave the repair permanently
    // unsatisfied — quiet, but with activeTabId stuck on a tab that is gone.
    expect(useAppStore.getState().activeTabId).toBe('t1')
    expect(useAppStore.getState().activeTabIdByWorktree['wt-active']).toBe('t1')
  })

  it('does not reallocate activeTabIdByWorktree when the tab is already active', () => {
    // Why: that map is a dependency of both the repair effect and the parked
    // watcher sync, so a redundant activation must not re-run either.
    useAppStore.setState({
      activeWorktreeId: 'wt-active',
      activeTabType: 'terminal',
      activeTabId: 't1',
      activeTabIdByWorktree: {},
      tabsByWorktree: { 'wt-active': [terminalTab('t1', 'wt-active')] },
      unifiedTabsByWorktree: {}
    })
    act(() => {
      useAppStore.getState().setActiveTab('t1')
    })
    const settled = useAppStore.getState().activeTabIdByWorktree
    act(() => {
      useAppStore.getState().setActiveTab('t1')
    })
    expect(useAppStore.getState().activeTabIdByWorktree).toBe(settled)
  })

  it('keeps bell attribution off a background worktree tab', () => {
    useAppStore.setState({
      activeWorktreeId: 'wt-active',
      activeTabType: 'terminal',
      activeTabId: 'visible-tab',
      activeTabIdByWorktree: {},
      tabsByWorktree: {
        'wt-active': [terminalTab('visible-tab', 'wt-active')],
        'wt-background': [terminalTab('bg-tab', 'wt-background')]
      },
      unifiedTabsByWorktree: {}
    })
    act(() => {
      useAppStore.getState().setActiveTab('bg-tab')
    })
    expect(useAppStore.getState().activeTabId).toBe('visible-tab')
    expect(useAppStore.getState().activeTabIdByWorktree['wt-background']).toBe('bg-tab')
  })
})
