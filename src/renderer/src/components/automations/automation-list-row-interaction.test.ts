// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import { isPortaledRowMenuClick } from './automation-list-row-interaction'

describe('isPortaledRowMenuClick', () => {
  it('detects clicks whose target is outside the row DOM', () => {
    const row = document.createElement('div')
    const portaledMenuItem = document.createElement('div')
    document.body.append(row, portaledMenuItem)

    expect(
      isPortaledRowMenuClick({
        target: portaledMenuItem,
        currentTarget: row
      })
    ).toBe(true)

    row.remove()
    portaledMenuItem.remove()
  })

  it('allows in-row clicks', () => {
    const row = document.createElement('div')
    const child = document.createElement('span')
    row.append(child)

    expect(
      isPortaledRowMenuClick({
        target: child,
        currentTarget: row
      })
    ).toBe(false)
  })
})
