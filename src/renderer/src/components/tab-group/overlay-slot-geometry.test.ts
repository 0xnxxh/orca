// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import {
  findTabGroupBodyElement,
  isOverlaySlotGeometryMismatched,
  measureOverlaySlotRect,
  shouldPreferMeasuredOverlayGeometry
} from './overlay-slot-geometry'

function rect(partial: Partial<DOMRect> & Pick<DOMRect, 'top' | 'left' | 'width' | 'height'>): DOMRect {
  const top = partial.top
  const left = partial.left
  const width = partial.width
  const height = partial.height
  return {
    top,
    left,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({})
  } as DOMRect
}

describe('overlay slot geometry', () => {
  it('finds the tab-group body by group id', () => {
    const body = document.createElement('div')
    body.dataset.tabGroupBodyId = 'group-a'
    document.body.appendChild(body)
    expect(findTabGroupBodyElement('group-a')).toBe(body)
    expect(findTabGroupBodyElement('missing')).toBeNull()
    body.remove()
  })

  it('measures body geometry relative to the overlay parent', () => {
    const parent = document.createElement('div')
    const body = document.createElement('div')
    parent.getBoundingClientRect = () => rect({ top: 100, left: 40, width: 900, height: 700 })
    body.getBoundingClientRect = () => rect({ top: 136, left: 40, width: 450, height: 664 })
    expect(measureOverlaySlotRect(parent, body)).toEqual({
      top: 36,
      left: 0,
      width: 450,
      height: 664
    })
  })

  it('detects post-snap overlay/body desync beyond tolerance', () => {
    expect(
      isOverlaySlotGeometryMismatched(
        rect({ top: 0, left: 0, width: 900, height: 700 }),
        rect({ top: 136, left: 40, width: 450, height: 664 })
      )
    ).toBe(true)
    expect(
      isOverlaySlotGeometryMismatched(
        rect({ top: 136.5, left: 40.5, width: 450, height: 664 }),
        rect({ top: 136, left: 40, width: 450, height: 664 })
      )
    ).toBe(false)
  })

  it('forces measured geometry when CSS-anchor hit-test drifts after a side-by-side snap', () => {
    const parent = document.createElement('div')
    const overlay = document.createElement('div')
    const body = document.createElement('div')
    body.dataset.tabGroupBodyId = 'group-snap'
    parent.appendChild(overlay)
    document.body.appendChild(parent)
    document.body.appendChild(body)

    // Why: after a column snap the overlay can still claim the pre-snap full-area
    // box while the body is only the right half — clicks then land in chrome/tabs.
    parent.getBoundingClientRect = () => rect({ top: 0, left: 0, width: 1000, height: 800 })
    overlay.getBoundingClientRect = () => rect({ top: 0, left: 0, width: 1000, height: 800 })
    body.getBoundingClientRect = () => rect({ top: 36, left: 500, width: 500, height: 764 })

    const result = shouldPreferMeasuredOverlayGeometry({
      overlay,
      groupId: 'group-snap',
      forceMeasured: false
    })
    expect(result.preferMeasured).toBe(true)
    expect(result.measured).toEqual({
      top: 36,
      left: 500,
      width: 500,
      height: 764
    })

    parent.remove()
    body.remove()
  })

  it('keeps CSS anchors when overlay geometry already matches the body', () => {
    const parent = document.createElement('div')
    const overlay = document.createElement('div')
    const body = document.createElement('div')
    body.dataset.tabGroupBodyId = 'group-ok'
    parent.appendChild(overlay)
    document.body.appendChild(parent)
    document.body.appendChild(body)

    const matched = rect({ top: 36, left: 0, width: 900, height: 700 })
    parent.getBoundingClientRect = () => rect({ top: 0, left: 0, width: 900, height: 736 })
    overlay.getBoundingClientRect = () => matched
    body.getBoundingClientRect = () => matched

    const result = shouldPreferMeasuredOverlayGeometry({
      overlay,
      groupId: 'group-ok',
      forceMeasured: false
    })
    expect(result.preferMeasured).toBe(false)
    expect(result.measured).toEqual({
      top: 36,
      left: 0,
      width: 900,
      height: 700
    })

    parent.remove()
    body.remove()
  })
})
