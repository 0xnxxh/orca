import { describe, expect, it } from 'vitest'
import { resolveBottomDrawerFillHeight } from './bottom-drawer-fill-height'

describe('resolveBottomDrawerFillHeight', () => {
  it('fills the space under the safe top when the keyboard is closed', () => {
    expect(
      resolveBottomDrawerFillHeight({
        screenHeight: 844,
        topInset: 54,
        keyboardInset: 0,
        topGap: 16
      })
    ).toBe(844 - 54 - 16)
  })

  it('shrinks by the keyboard inset so the sheet top stays under the status bar', () => {
    expect(
      resolveBottomDrawerFillHeight({
        screenHeight: 844,
        topInset: 54,
        keyboardInset: 292,
        topGap: 16
      })
    ).toBe(844 - 54 - 16 - 292)
  })

  it('clamps to a usable minimum on tiny viewports', () => {
    expect(
      resolveBottomDrawerFillHeight({
        screenHeight: 400,
        topInset: 50,
        keyboardInset: 300,
        topGap: 16,
        minHeight: 280
      })
    ).toBe(280)
  })

  it('pairs with marginBottom=keyboardInset so the sheet sits on the keyboard top', () => {
    // screen 844, top 54, gap 16, keyboard 292 → height 482; marginBottom 292
    // bottom edge at 844-292=552; top edge at 552-482=70 (= 54+16)
    const keyboardInset = 292
    const height = resolveBottomDrawerFillHeight({
      screenHeight: 844,
      topInset: 54,
      keyboardInset,
      topGap: 16
    })
    const topEdge = 844 - keyboardInset - height
    expect(height).toBe(482)
    expect(topEdge).toBe(54 + 16)
  })
})
