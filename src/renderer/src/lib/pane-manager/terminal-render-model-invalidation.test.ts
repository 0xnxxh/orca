import { describe, expect, it, vi } from 'vitest'
import { invalidateTerminalRenderModel } from './terminal-render-model-invalidation'

describe('invalidateTerminalRenderModel', () => {
  it('clears an available render service', () => {
    const clear = vi.fn()

    expect(invalidateTerminalRenderModel({ _core: { _renderService: { clear } } })).toBe(true)
    expect(clear).toHaveBeenCalledOnce()
  })

  it('safely ignores unavailable or disposed render services', () => {
    expect(invalidateTerminalRenderModel(null)).toBe(false)
    expect(invalidateTerminalRenderModel({ _core: {} })).toBe(false)
    expect(
      invalidateTerminalRenderModel({
        _core: {
          _renderService: {
            clear: () => {
              throw new Error('disposed')
            }
          }
        }
      })
    ).toBe(false)
  })
})
