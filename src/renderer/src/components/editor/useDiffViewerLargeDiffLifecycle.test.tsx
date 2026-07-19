// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const monacoFixture = vi.hoisted(() => {
  const models = new Map<
    string,
    { dispose: ReturnType<typeof vi.fn>; isAttachedToEditor: () => boolean }
  >()
  return {
    models,
    monaco: {
      Uri: { parse: (value: string) => value },
      editor: {
        getModel: (path: string) => models.get(path) ?? null
      }
    }
  }
})

vi.mock('@/lib/monaco-setup', () => ({ monaco: monacoFixture.monaco }))

import { getDiffViewerMonacoModelPaths } from './diff-monaco-model-disposal'
import { useDiffViewerLargeDiffLifecycle } from './useDiffViewerLargeDiffLifecycle'

function detachedModel(): {
  dispose: ReturnType<typeof vi.fn>
  isAttachedToEditor: () => boolean
} {
  return { dispose: vi.fn(), isAttachedToEditor: () => false }
}

describe('useDiffViewerLargeDiffLifecycle', () => {
  it('keeps repeated content rotations bounded to the current Monaco models', async () => {
    const modelKey = 'diff-tab'
    const originalModelKey = 'original-v1'
    const onEnterFallback = vi.fn()
    const paths = ['modified-v1', 'modified-v2', 'modified-v3'].map((modifiedModelKey) =>
      getDiffViewerMonacoModelPaths({
        modelKey,
        originalModelKey,
        modifiedModelKey,
        generationSuffix: ''
      })
    )
    const firstModel = detachedModel()
    const secondModel = detachedModel()
    const currentModel = detachedModel()
    monacoFixture.models.set(paths[0].modifiedModelPath, firstModel)
    monacoFixture.models.set(paths[1].modifiedModelPath, secondModel)
    monacoFixture.models.set(paths[2].modifiedModelPath, currentModel)

    const hook = renderHook(
      ({ modifiedModelKey }) =>
        useDiffViewerLargeDiffLifecycle({
          limited: false,
          modelKey,
          originalModelKey,
          modifiedModelKey,
          onEnterFallback
        }),
      { initialProps: { modifiedModelKey: 'modified-v1' } }
    )

    hook.rerender({ modifiedModelKey: 'modified-v2' })
    await act(() => new Promise<void>((resolve) => queueMicrotask(resolve)))
    hook.rerender({ modifiedModelKey: 'modified-v3' })
    await act(() => new Promise<void>((resolve) => queueMicrotask(resolve)))

    expect(firstModel.dispose).toHaveBeenCalledOnce()
    expect(secondModel.dispose).toHaveBeenCalledOnce()
    expect(currentModel.dispose).not.toHaveBeenCalled()
    expect(hook.result.current).toEqual(paths[2])
    expect(onEnterFallback).not.toHaveBeenCalled()
  })
})
