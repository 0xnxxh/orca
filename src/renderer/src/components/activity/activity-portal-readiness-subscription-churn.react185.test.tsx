/** @vitest-environment happy-dom */
import { act, useState } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { useActivityTerminalPortalStatus } from './ActivityPrototypePage'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const TAB_ID = 'tab-readiness-churn'
const OTHER_TAB_ID = 'tab-readiness-churn-other'
const LEAF_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const LEAF_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
const LEAF_C = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'
const PANE_A = `${TAB_ID}:${LEAF_A}`
const PANE_B = `${TAB_ID}:${LEAF_B}`
const OTHER_PANE_A = `${OTHER_TAB_ID}:${LEAF_A}`

let root: Root

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  document.body.replaceChildren()
})

function buildNeverReadyRoot(
  target: HTMLElement,
  tabId: string = TAB_ID,
  { append = false }: { append?: boolean } = {}
): void {
  const tabRoot = document.createElement('div')
  tabRoot.dataset.terminalTabId = tabId
  for (const leafId of [LEAF_A, LEAF_C]) {
    const pane = document.createElement('div')
    pane.dataset.leafId = leafId
    pane.setAttribute('data-pty-id', `pty-${leafId}`)
    pane.appendChild(Object.assign(document.createElement('div'), { className: 'xterm-screen' }))
    Object.defineProperty(pane, 'getClientRects', { value: () => [{}], configurable: true })
    tabRoot.appendChild(pane)
  }
  if (append) {
    target.appendChild(tabRoot)
    return
  }
  target.replaceChildren(tabRoot)
}

describe('Activity portal readiness subscription churn', () => {
  it('coalesces pane-key churn and commits the latest readiness', async () => {
    const target = document.createElement('div')
    buildNeverReadyRoot(target)
    document.body.append(target)

    let selectPane: (paneKey: string) => void = () => {}
    let renders = 0
    let status = 'loading'

    function ActivityTerminalSlot(): null {
      renders += 1
      const [paneKey, setPaneKey] = useState(PANE_A)
      selectPane = setPaneKey
      status = useActivityTerminalPortalStatus(target, paneKey)
      return null
    }

    root = createRoot(document.createElement('div'))
    act(() => {
      root.render(<ActivityTerminalSlot />)
    })

    act(() => {
      expect(() => {
        for (let index = 0; index < 29; index += 1) {
          flushSync(() => {
            selectPane(index % 2 === 0 ? PANE_B : PANE_A)
          })
        }
      }).not.toThrow()
    })
    expect(renders).toBeLessThanOrEqual(31)

    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    })
    expect(status).toBe('unavailable')
    expect(renders).toBeLessThanOrEqual(32)
  })

  // Why: the swap effect rewrites the slot element and the pane key together, so a latch scoped to
  // the subscription is rebuilt with an empty flip budget on every oscillation step.
  it('latches readiness when the portal target churns alongside the pane key', async () => {
    const targets = [document.createElement('div'), document.createElement('div')]
    for (const target of targets) {
      buildNeverReadyRoot(target)
      document.body.append(target)
    }

    let selectFlip: (flip: number) => void = () => {}
    let status = 'loading'

    function ActivityTerminalSlot(): null {
      const [flip, setFlip] = useState(0)
      selectFlip = setFlip
      // Alternating pane keys report 'loading' (unisolated sibling) then 'unavailable' (missing leaf).
      status = useActivityTerminalPortalStatus(targets[flip % 2], flip % 2 === 0 ? PANE_A : PANE_B)
      return null
    }

    root = createRoot(document.createElement('div'))
    act(() => {
      root.render(<ActivityTerminalSlot />)
    })

    for (let flip = 1; flip <= 40; flip += 1) {
      await act(async () => {
        selectFlip(flip)
      })
      await act(async () => {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      })
    }

    // Flip 40 is the 'loading' pairing, so only a latch that survived the churn can report this.
    expect(status).toBe('unavailable')
  })

  it('starts a fresh flip budget when the subscription moves to another tab', async () => {
    const target = document.createElement('div')
    buildNeverReadyRoot(target, TAB_ID)
    buildNeverReadyRoot(target, OTHER_TAB_ID, { append: true })
    document.body.append(target)

    let selectPane: (paneKey: string) => void = () => {}
    let status = 'loading'

    function ActivityTerminalSlot(): null {
      const [paneKey, setPaneKey] = useState(PANE_A)
      selectPane = setPaneKey
      status = useActivityTerminalPortalStatus(target, paneKey)
      return null
    }

    root = createRoot(document.createElement('div'))
    act(() => {
      root.render(<ActivityTerminalSlot />)
    })

    for (let flip = 0; flip < 40; flip += 1) {
      await act(async () => {
        selectPane(flip % 2 === 0 ? PANE_B : PANE_A)
      })
      await act(async () => {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      })
    }
    expect(status).toBe('unavailable')

    await act(async () => {
      selectPane(OTHER_PANE_A)
    })
    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    })
    // A latch shared across tabs would report the previous tab's latched 'unavailable' here.
    expect(status).toBe('loading')
  })
})
