/** @vitest-environment happy-dom */
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalTab } from '../../../../shared/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const handoff = vi.hoisted(() => ({
  mounted: false,
  prepared: false,
  allowPrepare: true,
  activated: false,
  entry: undefined as object | undefined
}))

vi.mock('../../store', async () => {
  const { create } = await import('zustand')
  const useAppStore = create(() => ({
    pendingStartupByTabId: {} as Record<string, unknown>,
    runtimeStatusByEnvironmentId: new Map<string, unknown>(),
    sleepingAgentSessionsByPaneKey: {},
    settings: {} as Record<string, unknown>,
    terminalLayoutsByTabId: {} as Record<string, unknown>,
    tabsByWorktree: {} as Record<string, TerminalTab[]>
  }))
  return { useAppStore }
})

vi.mock('./terminal-parked-tab-watchers', () => ({
  activatePreparedParkedTerminalTabWatchers: (args: { parkedTabIds: ReadonlySet<string> }) => {
    if (args.parkedTabIds.has('tab-b') && handoff.prepared) {
      handoff.activated = true
    }
  },
  disposeParkedTerminalWatchersForWorktree: () => {},
  getParkedTerminalWatcherEntry: () => handoff.entry,
  isParkedTerminalTabPreparationCurrent: () => handoff.prepared,
  selectParkedTerminalPaneCandidateKey: () => '',
  syncParkedTerminalTabWatchers: (args: { desiredParkedTabIds: ReadonlySet<string> }) => {
    if (!args.desiredParkedTabIds.has('tab-b')) {
      handoff.prepared = false
      handoff.entry = undefined
      return new Set<string>()
    }
    if (handoff.allowPrepare && (handoff.mounted || handoff.prepared)) {
      if (!handoff.prepared) {
        handoff.entry = {}
      }
      handoff.prepared = true
      return new Set(['tab-b'])
    }
    return new Set<string>()
  }
}))

vi.mock('./terminal-parking-e2e-overrides', () => ({
  getTerminalParkingPolicyOverrides: () => ({ coldParkDelayMs: 0, hotRetainMs: 0 })
}))

import { useAppStore } from '../../store'
import { useTerminalTabColdParking } from './use-terminal-tab-cold-parking'

const WORKTREE_ID = 'repo::/wt-park-handoff'
const EMPTY_ASSIGNMENTS = new Map<string, { groupId: string; isActiveInGroup: boolean }>()
const EMPTY_PORTALS: never[] = []

type ParkingStoreState = { tabsByWorktree: Record<string, TerminalTab[]> }

const parkingStore = useAppStore as unknown as {
  setState: (partial: (state: ParkingStoreState) => Partial<ParkingStoreState>) => void
}

function terminalTab(id: string): TerminalTab {
  return { id, ptyId: `${WORKTREE_ID}@@session-${id}`, title: id } as TerminalTab
}

let modelRevision = 0
function rewriteTabModel(): void {
  modelRevision += 1
  parkingStore.setState((state) => ({
    tabsByWorktree: {
      ...state.tabsByWorktree,
      [WORKTREE_ID]: state.tabsByWorktree[WORKTREE_ID].map((tab) => ({
        ...tab,
        title: `${tab.id}-${modelRevision}`
      }))
    }
  }))
}

let paneMounts = 0
let paneUnmounts = 0
let rewritePaneModel = true
function PaneStandIn(): null {
  useEffect(() => {
    handoff.mounted = true
    paneMounts += 1
    if (rewritePaneModel) {
      rewriteTabModel()
    }
    return () => {
      handoff.mounted = false
      paneUnmounts += 1
      if (rewritePaneModel) {
        rewriteTabModel()
      }
    }
  }, [])
  return null
}

let hostRenders = 0
let lastParked = false
function OverlayHost(): React.JSX.Element | null {
  hostRenders += 1
  const terminalTabs = useAppStore(
    (state) => (state as ParkingStoreState).tabsByWorktree[WORKTREE_ID]
  ) as TerminalTab[]
  const parkedTabIds = useTerminalTabColdParking({
    worktreeId: WORKTREE_ID,
    terminalTabs,
    assignments: EMPTY_ASSIGNMENTS,
    isWorktreeActive: false,
    coldParkTerminalPanes: false,
    shouldMeasureHiddenWorktree: false,
    activityTerminalPortals: EMPTY_PORTALS
  })
  lastParked = parkedTabIds.has('tab-b')
  return lastParked ? null : <PaneStandIn />
}

describe('cold-park prepare and commit handoff', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    handoff.mounted = false
    handoff.prepared = false
    handoff.allowPrepare = true
    handoff.activated = false
    handoff.entry = undefined
    paneMounts = 0
    paneUnmounts = 0
    rewritePaneModel = true
    hostRenders = 0
    lastParked = false
    modelRevision = 0
    parkingStore.setState(() => ({
      tabsByWorktree: {
        [WORKTREE_ID]: [terminalTab('tab-a'), terminalTab('tab-b')]
      }
    }))
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('prepares while mounted, parks once, and stays parked through unmount writes', () => {
    act(() => root.render(<OverlayHost />))

    expect(lastParked).toBe(true)
    expect(handoff.activated).toBe(true)
    expect(paneMounts).toBe(1)
    expect(paneUnmounts).toBe(1)
    expect(hostRenders).toBeLessThan(20)
  })

  it('keeps an unwatchable candidate mounted without verdict churn', () => {
    handoff.allowPrepare = false
    act(() => root.render(<OverlayHost />))

    expect(lastParked).toBe(false)
    expect(handoff.activated).toBe(false)
    expect(paneMounts).toBe(1)
    expect(paneUnmounts).toBe(0)
    expect(hostRenders).toBeLessThan(20)
  })

  it('reactivates a replacement preparation for the same parked tab', () => {
    act(() => root.render(<OverlayHost />))
    expect(lastParked).toBe(true)

    rewritePaneModel = false
    handoff.prepared = false
    handoff.activated = false
    lastParked = false
    act(() => rewriteTabModel())

    expect(lastParked).toBe(true)
    expect(handoff.activated).toBe(true)
    expect(paneMounts).toBe(2)
    expect(paneUnmounts).toBe(2)
    expect(hostRenders).toBeLessThan(30)
  })
})
