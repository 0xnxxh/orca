import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from '@/store'
import { recordSelfMoveForOpenTabs } from './record-self-move-for-open-tabs'
import {
  __clearSelfMoveRegistryForTests,
  isRecentSelfMoveSource,
  isRecentSelfMoveTarget
} from '@/components/editor/editor-self-move-registry'

describe('recordSelfMoveForOpenTabs', () => {
  beforeEach(() => {
    useAppStore.setState(useAppStore.getInitialState(), true)
    __clearSelfMoveRegistryForTests()
  })

  afterEach(() => {
    __clearSelfMoveRegistryForTests()
  })

  it('stamps the affected open tab so the watcher echo is self-recognized', () => {
    const state = useAppStore.getState()
    state.openFile(
      {
        filePath: '/repo/docs/readme.md',
        relativePath: 'docs/readme.md',
        worktreeId: 'wt-1',
        runtimeEnvironmentId: null,
        language: 'markdown',
        mode: 'edit'
      },
      { suppressActiveRuntimeFallback: true }
    )

    recordSelfMoveForOpenTabs('/repo/docs/readme.md', '/repo/notes/readme.md')

    expect(isRecentSelfMoveSource('/repo/docs/readme.md')).toBe(true)
    expect(isRecentSelfMoveTarget('/repo/notes/readme.md')).toBe(true)
  })

  it('maps each contained tab to its real new path on a directory move', () => {
    const state = useAppStore.getState()
    state.openFile(
      {
        filePath: '/repo/docs/guide/intro.md',
        relativePath: 'docs/guide/intro.md',
        worktreeId: 'wt-1',
        runtimeEnvironmentId: null,
        language: 'markdown',
        mode: 'edit'
      },
      { suppressActiveRuntimeFallback: true }
    )

    // Move the `docs` directory to `archive`.
    recordSelfMoveForOpenTabs('/repo/docs', '/repo/archive')

    expect(isRecentSelfMoveSource('/repo/docs/guide/intro.md')).toBe(true)
    expect(isRecentSelfMoveTarget('/repo/archive/guide/intro.md')).toBe(true)
  })

  it('ignores tabs outside the moved path', () => {
    const state = useAppStore.getState()
    state.openFile(
      {
        filePath: '/repo/other/keep.md',
        relativePath: 'other/keep.md',
        worktreeId: 'wt-1',
        runtimeEnvironmentId: null,
        language: 'markdown',
        mode: 'edit'
      },
      { suppressActiveRuntimeFallback: true }
    )

    recordSelfMoveForOpenTabs('/repo/docs', '/repo/archive')

    expect(isRecentSelfMoveSource('/repo/other/keep.md')).toBe(false)
  })
})
