import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as EditorAutosaveModule from '@/components/editor/editor-autosave'
import type { FsChangedPayload } from '../../../shared/types'

vi.mock('@/store', () => ({
  useAppStore: { getState: vi.fn() }
}))
vi.mock('@/components/editor/editor-autosave', async (importOriginal) => {
  const actual = await importOriginal<typeof EditorAutosaveModule>()
  return {
    ...actual,
    notifyEditorExternalFileChange: vi.fn(),
    getOpenFilesForExternalFileChange: vi.fn(() => [])
  }
})

import { createExternalWatchEventHandler } from './useEditorExternalWatch'
import { useAppStore } from '@/store'
import { getOpenFilesForExternalFileChange } from '@/components/editor/editor-autosave'
import { __clearSelfWriteRegistryForTests } from '@/components/editor/editor-self-write-registry'
import {
  __clearSelfMoveRegistryForTests,
  recordSelfMove
} from '@/components/editor/editor-self-move-registry'
import { getDiskBaselineSignature } from '@/components/editor/diff-content-signature'

const findTarget = (worktreePath: string, runtimeEnvironmentId: string | null = null) =>
  worktreePath === '/repo'
    ? {
        worktreeId: 'wt-1',
        worktreePath: '/repo',
        connectionId: undefined,
        runtimeEnvironmentId
      }
    : undefined

function payload(events: FsChangedPayload['events']): FsChangedPayload {
  return { worktreePath: '/repo', events }
}

describe('self-move suppression (registry-scoped)', () => {
  const setExternalMutation = vi.fn()
  const fileNotes = {
    id: 'file-notes',
    worktreeId: 'wt-1',
    worktreePath: '/repo',
    filePath: '/repo/notes.md',
    relativePath: 'notes.md',
    mode: 'edit' as const,
    isDirty: false
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.mocked(useAppStore.getState).mockReturnValue({
      openFiles: [fileNotes],
      setExternalMutation
    } as never)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    __clearSelfWriteRegistryForTests()
    __clearSelfMoveRegistryForTests()
  })

  it('does not tombstone a tab still at the old path when its delete is a self-move echo', () => {
    // Pre-remap ordering: delete(old) can arrive while the tab is still at the
    // old path. The stamp is recorded before the rename, so the source guard
    // still suppresses the tombstone — the tab is being re-homed, not deleted.
    recordSelfMove('/repo/notes.md', '/repo/subdir/notes.md')
    const { handleFsChanged, dispose } = createExternalWatchEventHandler(findTarget)

    handleFsChanged(payload([{ kind: 'delete', absolutePath: '/repo/notes.md' }]))
    vi.advanceTimersByTime(200)

    expect(setExternalMutation).not.toHaveBeenCalledWith('file-notes', 'deleted')
    expect(setExternalMutation).not.toHaveBeenCalledWith('file-notes', 'renamed')
    dispose()
  })

  it('surfaces a changed-on-disk conflict once the self-move TTL has expired', () => {
    const movedDirtyTab = {
      ...fileNotes,
      filePath: '/repo/subdir/notes.md',
      relativePath: 'subdir/notes.md',
      isDirty: true
    }
    vi.mocked(useAppStore.getState).mockReturnValue({
      openFiles: [movedDirtyTab],
      setExternalMutation
    } as never)
    vi.mocked(getOpenFilesForExternalFileChange).mockReturnValue([movedDirtyTab] as never)
    recordSelfMove('/repo/notes.md', '/repo/subdir/notes.md')
    const { handleFsChanged, dispose } = createExternalWatchEventHandler(findTarget)

    // Past the local TTL the path is no longer a live self-move target, so a real
    // external write goes through the normal changed-on-disk path.
    vi.advanceTimersByTime(1000)
    handleFsChanged(payload([{ kind: 'update', absolutePath: '/repo/subdir/notes.md' }]))
    vi.advanceTimersByTime(200)

    expect(setExternalMutation).toHaveBeenCalledWith('file-notes', 'changed')
    dispose()
  })

  it('marks changed for an event with no self-move stamp (no over-suppression)', () => {
    const movedDirtyTab = {
      ...fileNotes,
      filePath: '/repo/subdir/notes.md',
      relativePath: 'subdir/notes.md',
      isDirty: true
    }
    vi.mocked(useAppStore.getState).mockReturnValue({
      openFiles: [movedDirtyTab],
      setExternalMutation
    } as never)
    vi.mocked(getOpenFilesForExternalFileChange).mockReturnValue([movedDirtyTab] as never)
    const { handleFsChanged, dispose } = createExternalWatchEventHandler(findTarget)

    handleFsChanged(payload([{ kind: 'update', absolutePath: '/repo/subdir/notes.md' }]))
    vi.advanceTimersByTime(200)

    expect(setExternalMutation).toHaveBeenCalledWith('file-notes', 'changed')
    dispose()
  })
})

describe('self-move echo verification (content identity)', () => {
  const setExternalMutation = vi.fn()
  const setPendingLiveDiskVerification = vi.fn()
  const findTarget = (worktreePath: string, runtimeEnvironmentId: string | null = null) =>
    worktreePath === '/repo'
      ? {
          worktreeId: 'wt-1',
          worktreePath: '/repo',
          connectionId: undefined,
          runtimeEnvironmentId
        }
      : undefined

  const BASELINE_CONTENT = 'the file on disk\n'
  const baselineSignature = getDiskBaselineSignature(BASELINE_CONTENT)

  function movedDirtyTab(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: 'file-notes',
      worktreeId: 'wt-1',
      worktreePath: '/repo',
      filePath: '/repo/subdir/notes.md',
      relativePath: 'subdir/notes.md',
      mode: 'edit' as const,
      isDirty: true,
      lastKnownDiskSignature: baselineSignature,
      ...overrides
    }
  }

  function mockState(file: Record<string, unknown>): void {
    vi.mocked(useAppStore.getState).mockReturnValue({
      openFiles: [file],
      setExternalMutation,
      setPendingLiveDiskVerification,
      clearSelfMoveEcho: vi.fn()
    } as never)
    vi.mocked(getOpenFilesForExternalFileChange).mockReturnValue([file] as never)
  }

  function payload(events: FsChangedPayload['events']): FsChangedPayload {
    return { worktreePath: '/repo', events }
  }

  // Real readRuntimeFileContent reads local files via window.api.fs.readFile.
  function stubDiskRead(result: unknown): void {
    vi.stubGlobal('window', {
      api: { fs: { readFile: vi.fn().mockResolvedValue(result) } }
    })
  }

  function stubDiskReadError(error: Error): void {
    vi.stubGlobal('window', {
      api: { fs: { readFile: vi.fn().mockRejectedValue(error) } }
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    __clearSelfMoveRegistryForTests()
    __clearSelfWriteRegistryForTests()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    __clearSelfMoveRegistryForTests()
  })

  it('suspends autosave synchronously and suppresses when disk matches the baseline', async () => {
    mockState(movedDirtyTab())
    stubDiskRead({ isBinary: false, content: BASELINE_CONTENT })
    recordSelfMove('/repo/notes.md', '/repo/subdir/notes.md')
    const { handleFsChanged, dispose } = createExternalWatchEventHandler(findTarget)

    handleFsChanged(payload([{ kind: 'update', absolutePath: '/repo/subdir/notes.md' }]))
    // Autosave must be gated BEFORE the async read so it can't overwrite mid-read.
    expect(setPendingLiveDiskVerification).toHaveBeenCalledWith('file-notes', true)
    await vi.advanceTimersByTimeAsync(100)

    expect(setExternalMutation).not.toHaveBeenCalledWith('file-notes', 'changed')
    expect(setPendingLiveDiskVerification).toHaveBeenCalledWith('file-notes', false)
    dispose()
  })

  it('marks changed when a genuine external write differs from the baseline in-window', async () => {
    mockState(movedDirtyTab())
    stubDiskRead({ isBinary: false, content: 'an agent rewrote this file\n' })
    recordSelfMove('/repo/notes.md', '/repo/subdir/notes.md')
    const { handleFsChanged, dispose } = createExternalWatchEventHandler(findTarget)

    handleFsChanged(payload([{ kind: 'update', absolutePath: '/repo/subdir/notes.md' }]))
    await vi.advanceTimersByTimeAsync(100)

    expect(setExternalMutation).toHaveBeenCalledWith('file-notes', 'changed')
    expect(setPendingLiveDiskVerification).toHaveBeenCalledWith('file-notes', false)
    dispose()
  })

  it('fails closed (marks changed) when the tab has no disk baseline', async () => {
    mockState(movedDirtyTab({ lastKnownDiskSignature: undefined }))
    stubDiskRead({ isBinary: false, content: BASELINE_CONTENT })
    recordSelfMove('/repo/notes.md', '/repo/subdir/notes.md')
    const { handleFsChanged, dispose } = createExternalWatchEventHandler(findTarget)

    handleFsChanged(payload([{ kind: 'update', absolutePath: '/repo/subdir/notes.md' }]))
    await vi.advanceTimersByTimeAsync(100)

    expect(setExternalMutation).toHaveBeenCalledWith('file-notes', 'changed')
    dispose()
  })

  it('fails closed when the destination read errors', async () => {
    mockState(movedDirtyTab())
    stubDiskReadError(new Error('EACCES'))
    recordSelfMove('/repo/notes.md', '/repo/subdir/notes.md')
    const { handleFsChanged, dispose } = createExternalWatchEventHandler(findTarget)

    handleFsChanged(payload([{ kind: 'update', absolutePath: '/repo/subdir/notes.md' }]))
    await vi.advanceTimersByTimeAsync(100)

    expect(setExternalMutation).toHaveBeenCalledWith('file-notes', 'changed')
    expect(setPendingLiveDiskVerification).toHaveBeenCalledWith('file-notes', false)
    dispose()
  })

  it('fails closed when the destination is binary', async () => {
    mockState(movedDirtyTab())
    stubDiskRead({ isBinary: true, content: '' })
    recordSelfMove('/repo/notes.md', '/repo/subdir/notes.md')
    const { handleFsChanged, dispose } = createExternalWatchEventHandler(findTarget)

    handleFsChanged(payload([{ kind: 'update', absolutePath: '/repo/subdir/notes.md' }]))
    await vi.advanceTimersByTimeAsync(100)

    expect(setExternalMutation).toHaveBeenCalledWith('file-notes', 'changed')
    dispose()
  })
})
