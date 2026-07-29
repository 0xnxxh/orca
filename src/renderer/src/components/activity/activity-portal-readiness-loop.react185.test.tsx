/** @vitest-environment happy-dom */
import { act, useLayoutEffect, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

import { useActivityTerminalPortalStatus } from './ActivityPrototypePage'
import {
  findActivityTerminalPortal,
  type ActivityTerminalPortalTarget
} from './activity-terminal-portal'
import {
  reconcileActivityPortalThreads,
  resolveActivityPortalSwap,
  type ActivityPortalThreadRef
} from './activity-portal-thread-reconciliation'
import type { ActivityPortalReadinessStatus } from './activity-portal-readiness-oscillation'

const WORKTREE_ID = 'wt-1'
const TAB_ID = 'tab-react185'
const OTHER_TAB_ID = 'tab-react185-other'
const LEAF_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const LEAF_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
const LEAF_C = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'

const thread = (tabId: string, leafId: string): ActivityPortalThreadRef => ({
  paneKey: `${tabId}:${leafId}`,
  worktree: { id: WORKTREE_ID },
  tab: { id: tabId }
})

// Two panes of the SAME tab: one TerminalPane, swapped in place by isolatedPaneKey.
const PANE_A = thread(TAB_ID, LEAF_A)
const PANE_B = thread(TAB_ID, LEAF_B)
// A different tab: a genuinely separate TerminalPane, so staging applies.
const PANE_C = thread(OTHER_TAB_ID, LEAF_C)

let root: Root

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  document.body.replaceChildren()
})

/**
 * Models the DOM one portaled TerminalPane emits: a tab root holding every leaf
 * of the tab, with `applyExpandedLayoutTo` hiding the non-isolated siblings
 * inline. Readiness only reports 'ready' when the wanted leaf is the unhidden one.
 */
function renderPortaledTerminalPane(target: HTMLElement, tabId: string, leafIds: string[]): void {
  const isolatedLeafId = leafIds[0]
  const tabRoot = document.createElement('div')
  tabRoot.dataset.terminalTabId = tabId
  for (const leafId of leafIds) {
    const pane = document.createElement('div')
    pane.dataset.leafId = leafId
    pane.setAttribute('data-pty-id', `pty-${leafId}`)
    pane.appendChild(Object.assign(document.createElement('div'), { className: 'xterm-screen' }))
    if (leafId !== isolatedLeafId) {
      pane.style.display = 'none'
    }
    Object.defineProperty(pane, 'getClientRects', {
      value: () => (leafId === isolatedLeafId ? [{}] : []),
      configurable: true
    })
    tabRoot.appendChild(pane)
  }
  target.replaceChildren(tabRoot)
}

/**
 * Drives the whole Activity portal loop against the real collaborators:
 * reconcile -> publish descriptors -> Terminal's routing -> the readiness hook
 * -> swap. Everything runs in useLayoutEffect, React's SYNC lane, which is the
 * lane that increments nestedUpdateCount toward the #185 throw at 50.
 */
function runActivityPortalPage(args: {
  selectedThread: ActivityPortalThreadRef
  initialDisplayed: ActivityPortalThreadRef
  leafIdsByTabId: Record<string, string[]>
}): { displayedPaneKey: string | null; renders: number } {
  const { selectedThread, initialDisplayed, leafIdsByTabId } = args
  const slotEls = {
    primary: document.createElement('div'),
    secondary: document.createElement('div')
  }
  document.body.append(slotEls.primary, slotEls.secondary)
  const threadsByPaneKey = new Map(
    [selectedThread, initialDisplayed].map((entry) => [entry.paneKey, entry])
  )
  let renders = 0
  let displayedPaneKey: string | null = initialDisplayed.paneKey

  function ActivityPortalPage(): null {
    renders += 1
    const [displayed, setDisplayed] = useState<string | null>(initialDisplayed.paneKey)
    const [activeSlotId, setActiveSlotId] = useState<'primary' | 'secondary'>('primary')
    displayedPaneKey = displayed
    const inactiveSlotId = activeSlotId === 'primary' ? 'secondary' : 'primary'

    const { visibleThread, stagedThread } = reconcileActivityPortalThreads({
      selectedThread,
      displayedThread: displayed ? (threadsByPaneKey.get(displayed) ?? null) : null,
      selectedHasLiveTab: true,
      displayedHasLiveTab: true
    })

    const descriptors: ActivityTerminalPortalTarget[] = []
    if (visibleThread) {
      descriptors.push({
        slotId: activeSlotId,
        requestToken: `${activeSlotId}:${visibleThread.paneKey}`,
        target: slotEls[activeSlotId],
        worktreeId: WORKTREE_ID,
        tabId: visibleThread.tab.id,
        paneKey: visibleThread.paneKey,
        active: true
      })
    }
    if (stagedThread) {
      descriptors.push({
        slotId: inactiveSlotId,
        requestToken: `${inactiveSlotId}:${stagedThread.paneKey}`,
        target: slotEls[inactiveSlotId],
        worktreeId: WORKTREE_ID,
        tabId: stagedThread.tab.id,
        paneKey: stagedThread.paneKey,
        active: false
      })
    }

    // Why: Terminal mounts one TerminalPane per (worktree, tab) and resolves its
    // portal target with worktree+tab only -- reproduced here so the test feels
    // the same routing the crash did.
    useLayoutEffect(() => {
      slotEls.primary.replaceChildren()
      slotEls.secondary.replaceChildren()
      for (const tabId of Object.keys(leafIdsByTabId)) {
        const routed = findActivityTerminalPortal(descriptors, { worktreeId: WORKTREE_ID, tabId })
        if (!routed) {
          continue
        }
        const isolatedLeafId = routed.paneKey.slice(routed.paneKey.indexOf(':') + 1)
        const leafIds = leafIdsByTabId[tabId]
        renderPortaledTerminalPane(routed.target, tabId, [
          isolatedLeafId,
          ...leafIds.filter((leafId) => leafId !== isolatedLeafId)
        ])
      }
    })

    const visibleStatus = useActivityTerminalPortalStatus(
      slotEls[activeSlotId],
      visibleThread?.paneKey ?? null
    )
    const stagedStatus = useActivityTerminalPortalStatus(
      slotEls[inactiveSlotId],
      stagedThread?.paneKey ?? null
    )

    useLayoutEffect(() => {
      const swap = resolveActivityPortalSwap({
        selectedThread,
        selectedHasLiveTab: true,
        visibleThread,
        stagedThread,
        visiblePortalReady: visibleStatus === 'ready',
        stagedPortalReady: stagedStatus === 'ready',
        stagedPortalUnavailable: stagedStatus === 'unavailable'
      })
      if (swap?.kind === 'clear') {
        setDisplayed(null)
        return
      }
      if (swap?.kind === 'swap-staged') {
        setActiveSlotId(inactiveSlotId)
        setDisplayed(swap.paneKey)
        return
      }
      if (swap?.kind === 'settle-visible') {
        setDisplayed(swap.paneKey)
      }
      // Why these deps: mirror ActivityPrototypePage's swap effect, so a
      // convergence failure here means the page fails to converge too.
    }, [inactiveSlotId, stagedStatus, stagedThread, visibleStatus, visibleThread])
    return null
  }

  root = createRoot(document.createElement('div'))
  act(() => {
    root.render(<ActivityPortalPage />)
  })
  return { displayedPaneKey, renders }
}

describe('Activity portal pane switching', () => {
  it('converges on a newly selected pane of the tab already on screen', () => {
    // Why this shape: staging a same-tab pane would need a second TerminalPane
    // for one (worktree, tab), which Terminal never mounts -- the staged slot
    // would stay empty, its readiness would stay 'loading', no swap arm would
    // fire, and Activity would show the old pane under the new row forever.
    const run = (): { displayedPaneKey: string | null; renders: number } =>
      runActivityPortalPage({
        selectedThread: PANE_B,
        initialDisplayed: PANE_A,
        leafIdsByTabId: { [TAB_ID]: [LEAF_A, LEAF_B] }
      })

    let result: { displayedPaneKey: string | null; renders: number } | null = null
    expect(() => {
      result = run()
    }).not.toThrow()
    expect(result!.displayedPaneKey).toBe(PANE_B.paneKey)
    expect(result!.renders).toBeLessThan(50)
  })

  it('stages and swaps when the selected pane belongs to a different tab', () => {
    const result = runActivityPortalPage({
      selectedThread: PANE_C,
      initialDisplayed: PANE_A,
      leafIdsByTabId: { [TAB_ID]: [LEAF_A, LEAF_B], [OTHER_TAB_ID]: [LEAF_C] }
    })
    expect(result.displayedPaneKey).toBe(PANE_C.paneKey)
    expect(result.renders).toBeLessThan(50)
  })

  /**
   * Defense in depth, driven through the real hook so the assertion covers the
   * production wiring and not just the latch module: if any DOM conflation makes
   * 'ready' unreachable while 'unavailable' stays reachable, useActivityTerminal-
   * PortalStatus must stop the sync-lane churn. nestedUpdateCount is global per
   * root, so an unbounded spin surfaces in any unrelated component -- the reason
   * this cluster appeared under four different error boundaries.
   */
  it('bounds a readiness oscillation driven through the real portal-status hook', async () => {
    const target = document.createElement('div')
    document.body.append(target)
    // Hidden leaf -> 'unavailable'; nothing hidden -> 'loading' (an unhidden
    // sibling suppresses 'ready'). 'ready' is unreachable, so the pair spins.
    const buildRoot = (hiddenLeafId: string | null): void => {
      const tabRoot = document.createElement('div')
      tabRoot.dataset.terminalTabId = TAB_ID
      for (const leafId of [LEAF_A, LEAF_B]) {
        const pane = document.createElement('div')
        pane.dataset.leafId = leafId
        pane.setAttribute('data-pty-id', `pty-${leafId}`)
        pane.appendChild(
          Object.assign(document.createElement('div'), { className: 'xterm-screen' })
        )
        if (leafId === hiddenLeafId) {
          pane.style.display = 'none'
        }
        Object.defineProperty(pane, 'getClientRects', { value: () => [{}], configurable: true })
        tabRoot.appendChild(pane)
      }
      target.replaceChildren(tabRoot)
    }
    buildRoot(LEAF_A)

    let renders = 0
    const statuses: ActivityPortalReadinessStatus[] = []
    // Why a hard cap: an unlatched spin never settles, so `act` would hang until
    // the suite timeout instead of failing on the assertion below. Stop feeding
    // the loop past the cap so the test fails fast and legibly.
    const RENDER_CAP = 50

    function ActivityTerminalSlot(): null {
      renders += 1
      const status = useActivityTerminalPortalStatus(target, PANE_A.paneKey)
      statuses.push(status)
      // Models Terminal re-applying the opposite isolation, which the hook's
      // MutationObserver then reports back as the opposite readiness.
      useLayoutEffect(() => {
        if (renders > RENDER_CAP) {
          return
        }
        if (status === 'unavailable') {
          buildRoot(null)
        } else if (status === 'loading') {
          buildRoot(LEAF_A)
        }
      })
      return null
    }

    root = createRoot(document.createElement('div'))
    await act(async () => {
      root.render(<ActivityTerminalSlot />)
      await new Promise((resolve) => setTimeout(resolve, 60))
    })

    // Latched: the hook stops emitting new states well before React's 50-deep
    // sync-update throw, and stays parked on 'unavailable'.
    expect(renders).toBeLessThanOrEqual(RENDER_CAP)
    expect(statuses.at(-1)).toBe('unavailable')
  })

  /**
   * The latch's one user-facing risk: pinning "Terminal unavailable" over a
   * terminal that churned during a slow attach and then genuinely came up. The
   * latch only rewrites the hook's output, never the DOM probe, so a real
   * 'ready' still arrives and releases it. Asserted through the real hook
   * because the subscription is rebuilt only on target/paneKey change.
   */
  it('releases a latched readiness once the terminal genuinely attaches', async () => {
    const target = document.createElement('div')
    document.body.append(target)
    const buildRoot = (mode: 'hidden' | 'sibling' | 'ready'): void => {
      const tabRoot = document.createElement('div')
      tabRoot.dataset.terminalTabId = TAB_ID
      for (const leafId of [LEAF_A, LEAF_B]) {
        const pane = document.createElement('div')
        pane.dataset.leafId = leafId
        pane.setAttribute('data-pty-id', `pty-${leafId}`)
        pane.appendChild(
          Object.assign(document.createElement('div'), { className: 'xterm-screen' })
        )
        if (mode === 'hidden' && leafId === LEAF_A) {
          pane.style.display = 'none'
        }
        if (mode === 'ready' && leafId === LEAF_B) {
          pane.style.display = 'none'
        }
        Object.defineProperty(pane, 'getClientRects', { value: () => [{}], configurable: true })
        tabRoot.appendChild(pane)
      }
      target.replaceChildren(tabRoot)
    }
    buildRoot('hidden')

    let churning = true
    let churns = 0
    const statuses: ActivityPortalReadinessStatus[] = []

    function ActivityTerminalSlot(): null {
      const status = useActivityTerminalPortalStatus(target, PANE_A.paneKey)
      statuses.push(status)
      useLayoutEffect(() => {
        if (!churning || churns > 30) {
          return
        }
        churns += 1
        buildRoot(status === 'unavailable' ? 'sibling' : 'hidden')
      })
      return null
    }

    root = createRoot(document.createElement('div'))
    await act(async () => {
      root.render(<ActivityTerminalSlot />)
      await new Promise((resolve) => setTimeout(resolve, 60))
    })
    expect(statuses.at(-1)).toBe('unavailable')

    churning = false
    await act(async () => {
      buildRoot('ready')
      await new Promise((resolve) => setTimeout(resolve, 60))
    })
    expect(statuses.at(-1)).toBe('ready')
  })
})
