import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('terminal delivery credit', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('restores an outer delivery after a nested delivery returns', async () => {
    const { deliverTerminalDataWithDeferredCredit, takeCurrentTerminalDeliveryCredit } =
      await import('./terminal-delivery-credit')
    const completeOuter = vi.fn()
    const completeInner = vi.fn()
    let outerCredit: (() => void) | null = null
    let innerCredit: (() => void) | null = null

    deliverTerminalDataWithDeferredCredit(completeOuter, () => {
      deliverTerminalDataWithDeferredCredit(completeInner, () => {
        innerCredit = takeCurrentTerminalDeliveryCredit()
      })
      outerCredit = takeCurrentTerminalDeliveryCredit()
    })

    expect(completeOuter).not.toHaveBeenCalled()
    expect(completeInner).not.toHaveBeenCalled()
    innerCredit!()
    outerCredit!()
    expect(completeInner).toHaveBeenCalledOnce()
    expect(completeOuter).toHaveBeenCalledOnce()
  })
})
