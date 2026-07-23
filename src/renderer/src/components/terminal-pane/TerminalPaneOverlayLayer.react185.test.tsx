/**
 * @vitest-environment happy-dom
 *
 * Regression for React error #185 ("Maximum update depth exceeded") reported
 * ONLY on Windows (Orca 1.4.148 / 1.4.149, boundary `terminal.workbench`,
 * reports f1783c09 / 5ff8a4e6 / 52aabedb).
 *
 * The overlay fallback-measurement path (taken when CSS anchor positioning is
 * unavailable) writes a BRAND-NEW rect object on every ResizeObserver tick with
 * no equality guard. A stable geometry therefore still "changes" state on every
 * measurement, re-running the fit effect -> SYNC_FIT -> xterm fit() -> resize ->
 * ResizeObserver -> ... an unbounded measure<->fit loop that never settles.
 *
 * This test forces the fallback path (`__ORCA_WEB_CLIENT__ = true`) and drives
 * the ResizeObserver callback with a CONSTANT rect. On buggy HEAD every tick
 * commits a fresh object, so the slot re-renders once per tick (render churn
 * grows unboundedly). With the equality guard the state bails out and the slot
 * settles after the first measurement.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Opt into React's act() testing environment so effect flushes are deterministic.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Count TerminalPane renders as a proxy for slot commits: the slot re-creates
// the TerminalPane element on every render, so each commit calls this mock once.
let terminalPaneRenderCount = 0
vi.mock('./TerminalPane', () => ({
  default: () => {
    terminalPaneRenderCount += 1
    return null
  }
}))

// The slot only reads `useAppStore.getState().pendingStartupByTabId`; stub it so
// the test never boots the real (heavy, side-effectful) app store.
vi.mock('../../store', () => ({
  useAppStore: Object.assign(() => undefined, {
    getState: () => ({ pendingStartupByTabId: {} })
  })
}))

import { TerminalOverlaySlot } from './TerminalPaneOverlayLayer'

const GROUP_ID = 'group-react185'
const TAB_ID = 'tab-react185'

const CONSTANT_PARENT_RECT: DOMRect = {
  top: 0,
  left: 0,
  right: 800,
  bottom: 600,
  width: 800,
  height: 600,
  x: 0,
  y: 0,
  toJSON: () => ({})
}
// A stable body rect: sub-pixel-identical on every tick.
const CONSTANT_BODY_RECT: DOMRect = {
  top: 32,
  left: 0,
  right: 800,
  bottom: 600,
  width: 800,
  height: 568,
  x: 0,
  y: 32,
  toJSON: () => ({})
}

let capturedResizeCallback: (() => void) | null = null
let container: HTMLDivElement
let bodyEl: HTMLDivElement
let root: Root

class CapturingResizeObserver {
  constructor(cb: () => void) {
    capturedResizeCallback = cb
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function renderSlot(): void {
  root = createRoot(container)
  act(() => {
    root.render(
      <TerminalOverlaySlot
        terminalTabId={TAB_ID}
        terminalGeneration={0}
        worktreeId="wt-1"
        worktreePath="/tmp/wt-1"
        startupCwd={undefined}
        groupId={GROUP_ID}
        isWorktreeActive
        isVisible
        isActive
        activityTerminalPortal={null}
        onFocusOwningGroup={vi.fn()}
        consumeSuppressedPtyExit={() => false}
        leaveWorktreeIfEmpty={vi.fn()}
      />
    )
  })
}

beforeEach(() => {
  terminalPaneRenderCount = 0
  capturedResizeCallback = null
  ;(globalThis as { __ORCA_WEB_CLIENT__?: boolean }).__ORCA_WEB_CLIENT__ = true
  vi.stubGlobal('ResizeObserver', CapturingResizeObserver)

  container = document.createElement('div')
  container.getBoundingClientRect = () => CONSTANT_PARENT_RECT
  document.body.appendChild(container)

  bodyEl = document.createElement('div')
  bodyEl.setAttribute('data-tab-group-body-id', GROUP_ID)
  bodyEl.getBoundingClientRect = () => CONSTANT_BODY_RECT
  document.body.appendChild(bodyEl)
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  bodyEl?.remove()
  vi.unstubAllGlobals()
  delete (globalThis as { __ORCA_WEB_CLIENT__?: boolean }).__ORCA_WEB_CLIENT__
})

describe('TerminalPaneOverlayLayer fallback measure<->fit loop (React #185)', () => {
  it('does not re-render on ResizeObserver ticks with an unchanged rect', () => {
    renderSlot()

    // Sanity: the fallback measuring effect installed a ResizeObserver.
    expect(capturedResizeCallback).toBeTypeOf('function')

    const rendersAfterMount = terminalPaneRenderCount

    // Drive the observer with the SAME geometry many times. A settled overlay
    // must not keep committing new state for identical measurements.
    const TICKS = 50
    for (let i = 0; i < TICKS; i += 1) {
      act(() => {
        capturedResizeCallback?.()
      })
    }

    const extraRenders = terminalPaneRenderCount - rendersAfterMount

    // Buggy HEAD: every tick writes a new rect object -> ~TICKS extra renders
    // (unbounded churn -> React #185). Fixed: the equality guard bails -> 0.
    expect(extraRenders).toBeLessThanOrEqual(1)
  })
})
