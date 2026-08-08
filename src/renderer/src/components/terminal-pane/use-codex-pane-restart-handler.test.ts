// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useCodexPaneRestartHandler } from './use-codex-pane-restart-handler'

describe('useCodexPaneRestartHandler', () => {
  it('uses the current pane generation after a rerender', () => {
    const restartPaneAtGeneration = vi.fn()
    const view = renderHook(
      ({ paneGeneration }) =>
        useCodexPaneRestartHandler({ paneGeneration, restartPaneAtGeneration }),
      { initialProps: { paneGeneration: 7 } }
    )

    act(() => view.result.current(3))
    view.rerender({ paneGeneration: 8 })
    act(() => view.result.current(3))

    expect(restartPaneAtGeneration).toHaveBeenNthCalledWith(1, 3, 7)
    expect(restartPaneAtGeneration).toHaveBeenNthCalledWith(2, 3, 8)
  })
})
