import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ModelManager } from './model-manager'

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/orca-speech-models-test'
  }
}))

type ModelManagerInternals = {
  updateState: (
    modelId: string,
    status: 'not-downloaded' | 'downloading' | 'extracting' | 'ready' | 'error',
    progress?: number,
    error?: string
  ) => void
}

describe('ModelManager progress callbacks', () => {
  it('unsubscribes progress callbacks without replacing other listeners', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-model-manager-'))
    try {
      const manager = new ModelManager(dir)
      const internals = manager as unknown as ModelManagerInternals
      const first = vi.fn()
      const second = vi.fn()
      const clearFirst = manager.setProgressCallback(first)
      const clearSecond = manager.setProgressCallback(second)

      internals.updateState('model-a', 'downloading', 0.25)
      clearFirst()
      internals.updateState('model-a', 'extracting')
      clearSecond()
      internals.updateState('model-a', 'ready')

      expect(first).toHaveBeenCalledTimes(1)
      expect(first).toHaveBeenCalledWith('model-a', 0.25)
      expect(second).toHaveBeenCalledTimes(2)
      expect(second).toHaveBeenNthCalledWith(1, 'model-a', 0.25)
      expect(second).toHaveBeenNthCalledWith(2, 'model-a', 0.95)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('coalesces per-chunk download progress to whole percent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-model-manager-'))
    try {
      const manager = new ModelManager(dir)
      const internals = manager as unknown as ModelManagerInternals
      const listener = vi.fn()
      manager.setProgressCallback(listener)

      // A 500MB model over a 64KB chunk stream reports this many times.
      for (let chunk = 0; chunk < 8_000; chunk += 1) {
        internals.updateState('model-a', 'downloading', chunk / 8_000)
      }

      expect(listener.mock.calls.length).toBeLessThanOrEqual(101)
      // Status transitions must still reach the UI unconditionally.
      const afterDownload = listener.mock.calls.length
      internals.updateState('model-a', 'extracting')
      internals.updateState('model-a', 'ready')
      expect(listener.mock.calls.length).toBe(afterDownload + 2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('re-emits a repeated ready so a stale pane still resyncs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-model-manager-'))
    try {
      const manager = new ModelManager(dir)
      const internals = manager as unknown as ModelManagerInternals
      const listener = vi.fn()
      manager.setProgressCallback(listener)

      // downloadModel's already-downloaded branch: this lone 'ready' is the only
      // notification the requesting window receives before the handler returns.
      internals.updateState('model-a', 'ready')
      internals.updateState('model-a', 'ready')

      expect(listener).toHaveBeenCalledTimes(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // Why this matters: the renderer discards the progress event payload and re-polls
  // getModelState, so coalescing only the fan-out leaves the polled path raw.
  it('reports whole-percent progress to pollers during a download', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-model-manager-'))
    try {
      const manager = new ModelManager(dir)
      const internals = manager as unknown as ModelManagerInternals
      const seen = new Set<number | undefined>()

      for (let chunk = 0; chunk < 8000; chunk += 1) {
        internals.updateState('whisper-tiny', 'downloading', chunk / 8000)
        seen.add((await manager.getModelState('whisper-tiny')).progress)
      }

      expect(seen.size).toBeLessThanOrEqual(101)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
