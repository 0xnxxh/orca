import { describe, expect, it, vi } from 'vitest'
import { resubscribeMobileTerminalAfterInitialViewport } from './mobile-terminal-initial-viewport-resubscribe'

function createRef() {
  return {
    awaitRenderReady: vi.fn(async () => true),
    isRenderReadyGenerationCurrent: vi.fn(() => true),
    measureFitDimensions: vi.fn(async () => ({ cols: 100, rows: 30 }))
  }
}

describe('resubscribeMobileTerminalAfterInitialViewport', () => {
  it('admits current dimensions after WebView readiness', async () => {
    const ref = createRef()
    const onMeasured = vi.fn()

    await resubscribeMobileTerminalAfterInitialViewport({
      handle: 'terminal',
      sequence: 3,
      initGeneration: 7,
      frameHeight: 640,
      getSequence: () => 3,
      getRef: () => ref,
      onMeasured
    })

    expect(ref.awaitRenderReady).toHaveBeenCalledWith(7)
    expect(ref.measureFitDimensions).toHaveBeenCalledWith(640)
    expect(onMeasured).toHaveBeenCalledWith({ cols: 100, rows: 30 })
  })

  it('rejects a late measurement after subscription replacement', async () => {
    let sequence = 3
    let resolveDimensions!: (value: { cols: number; rows: number }) => void
    const ref = {
      awaitRenderReady: vi.fn(async () => true),
      isRenderReadyGenerationCurrent: vi.fn(() => true),
      measureFitDimensions: vi.fn(
        () =>
          new Promise<{ cols: number; rows: number }>((resolve) => {
            resolveDimensions = resolve
          })
      )
    }
    const onMeasured = vi.fn()
    const pending = resubscribeMobileTerminalAfterInitialViewport({
      handle: 'terminal',
      sequence,
      initGeneration: 7,
      frameHeight: 640,
      getSequence: () => sequence,
      getRef: () => ref,
      onMeasured
    })

    await Promise.resolve()
    sequence = 4
    resolveDimensions({ cols: 100, rows: 30 })
    await pending

    expect(onMeasured).not.toHaveBeenCalled()
  })

  it('rejects a late measurement after same-subscription reinitialization', async () => {
    let isGenerationCurrent = true
    let resolveDimensions!: (value: { cols: number; rows: number }) => void
    const ref = {
      awaitRenderReady: vi.fn(async () => true),
      isRenderReadyGenerationCurrent: vi.fn(() => isGenerationCurrent),
      measureFitDimensions: vi.fn(
        () =>
          new Promise<{ cols: number; rows: number }>((resolve) => {
            resolveDimensions = resolve
          })
      )
    }
    const onMeasured = vi.fn()
    const pending = resubscribeMobileTerminalAfterInitialViewport({
      handle: 'terminal',
      sequence: 3,
      initGeneration: 7,
      frameHeight: 640,
      getSequence: () => 3,
      getRef: () => ref,
      onMeasured
    })

    await Promise.resolve()
    isGenerationCurrent = false
    resolveDimensions({ cols: 100, rows: 30 })
    await pending

    expect(ref.isRenderReadyGenerationCurrent).toHaveBeenCalledTimes(2)
    expect(onMeasured).not.toHaveBeenCalled()
  })
})
