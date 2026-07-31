import { describe, expect, it, vi } from 'vitest'
import type { TerminalWebViewHandle } from '../terminal/terminal-webview-contract'
import { settleMobileTerminalColdRenderReady } from './mobile-terminal-cold-render-readiness'

function createHarness() {
  let resolveReady!: (ready: boolean) => void
  let revision: number | null = 4
  let currentGeneration = 2
  const ref = {
    awaitRenderReady: vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveReady = resolve
        })
    ),
    isRenderReadyGenerationCurrent: vi.fn((generation: number) => generation === currentGeneration)
  } as unknown as TerminalWebViewHandle
  const complete = vi.fn(() => true)
  const onReady = vi.fn()
  const onTimeout = vi.fn()
  const settle = () =>
    settleMobileTerminalColdRenderReady({
      handle: 'cold',
      revision: 4,
      sequence: 8,
      ref,
      initGeneration: 2,
      getRevision: () => revision,
      getSequence: () => 8,
      acceptsStreamEvent: () => true,
      getRef: () => ref,
      complete,
      onReady,
      onTimeout
    })
  return {
    complete,
    failOpen: () => {
      revision = null
    },
    onReady,
    onTimeout,
    resolveReady: (ready: boolean) => resolveReady(ready),
    settle,
    supersede: () => {
      currentGeneration = 3
    }
  }
}

describe('mobile terminal cold render readiness', () => {
  it('ignores readiness after fail-open without logging success', async () => {
    const harness = createHarness()
    const result = harness.settle()

    harness.failOpen()
    harness.resolveReady(true)

    await expect(result).resolves.toBe(false)
    expect(harness.complete).not.toHaveBeenCalled()
    expect(harness.onReady).not.toHaveBeenCalled()
    expect(harness.onTimeout).not.toHaveBeenCalled()
  })

  it('ignores a same-ref superseded init without failing open', async () => {
    const harness = createHarness()
    const result = harness.settle()

    harness.supersede()
    harness.resolveReady(false)

    await expect(result).resolves.toBe(false)
    expect(harness.complete).not.toHaveBeenCalled()
    expect(harness.onReady).not.toHaveBeenCalled()
    expect(harness.onTimeout).not.toHaveBeenCalled()
  })

  it('completes only the exact current handle and revision', async () => {
    const harness = createHarness()
    const result = harness.settle()

    harness.resolveReady(true)

    await expect(result).resolves.toBe(true)
    expect(harness.complete).toHaveBeenCalledWith('cold', 4)
    expect(harness.onReady).toHaveBeenCalledOnce()
    expect(harness.onTimeout).not.toHaveBeenCalled()
  })

  it('fails open only when the exact current generation times out', async () => {
    const harness = createHarness()
    const result = harness.settle()

    harness.resolveReady(false)

    await expect(result).resolves.toBe(false)
    expect(harness.onTimeout).toHaveBeenCalledOnce()
    expect(harness.complete).not.toHaveBeenCalled()
    expect(harness.onReady).not.toHaveBeenCalled()
  })
})
