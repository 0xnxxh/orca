import { describe, expect, it } from 'vitest'
import type { PersistedOpenFile, WorkspaceSessionState } from '../../../shared/types'
import {
  capRestoredOpenFilesByWorktree,
  MAX_RESTORED_OPEN_FILES_PER_WORKSPACE
} from './workspace-session-open-file-cap'

function persistedFile(index: number, overrides: Partial<PersistedOpenFile> = {}) {
  return {
    filePath: `/repo/src/file-${index}.ts`,
    relativePath: `src/file-${index}.ts`,
    worktreeId: 'wt-1',
    language: 'typescript',
    ...overrides
  } satisfies PersistedOpenFile
}

function sessionWith(
  openFilesByWorktree: Record<string, PersistedOpenFile[]>,
  activeFileIdByWorktree?: Record<string, string>
): WorkspaceSessionState {
  return { openFilesByWorktree, activeFileIdByWorktree } as unknown as WorkspaceSessionState
}

describe('capRestoredOpenFilesByWorktree', () => {
  it('returns the same session object when every workspace is under the cap', () => {
    const session = sessionWith({
      'wt-1': Array.from({ length: MAX_RESTORED_OPEN_FILES_PER_WORKSPACE }, (_, i) =>
        persistedFile(i)
      )
    })

    expect(capRestoredOpenFilesByWorktree(session)).toBe(session)
  })

  it('keeps the newest entries when a workspace exceeds the cap', () => {
    const total = MAX_RESTORED_OPEN_FILES_PER_WORKSPACE + 50
    const session = sessionWith({
      'wt-1': Array.from({ length: total }, (_, i) => persistedFile(i))
    })

    const kept = capRestoredOpenFilesByWorktree(session).openFilesByWorktree?.['wt-1'] ?? []

    expect(kept).toHaveLength(MAX_RESTORED_OPEN_FILES_PER_WORKSPACE)
    expect(kept[0]?.filePath).toBe(persistedFile(50).filePath)
    expect(kept.at(-1)?.filePath).toBe(persistedFile(total - 1).filePath)
  })

  it('never drops a file with an unsaved draft, even from the oldest entries', () => {
    const total = MAX_RESTORED_OPEN_FILES_PER_WORKSPACE + 50
    const files = Array.from({ length: total }, (_, i) =>
      persistedFile(i, i === 0 ? { dirtyDraftContent: 'unsaved work' } : {})
    )

    const kept = capRestoredOpenFilesByWorktree(sessionWith({ 'wt-1': files }))
      .openFilesByWorktree?.['wt-1']

    expect(kept?.[0]?.dirtyDraftContent).toBe('unsaved work')
    expect(kept).toHaveLength(MAX_RESTORED_OPEN_FILES_PER_WORKSPACE)
  })

  it('keeps every dirty file even when they alone exceed the cap', () => {
    const total = MAX_RESTORED_OPEN_FILES_PER_WORKSPACE + 20
    const files = Array.from({ length: total }, (_, i) =>
      persistedFile(i, { dirtyDraftContent: `draft ${i}` })
    )

    const kept = capRestoredOpenFilesByWorktree(sessionWith({ 'wt-1': files }))
      .openFilesByWorktree?.['wt-1']

    expect(kept).toHaveLength(total)
  })

  it('keeps the focused tab addressed by its raw path id', () => {
    const total = MAX_RESTORED_OPEN_FILES_PER_WORKSPACE + 50
    const files = Array.from({ length: total }, (_, i) => persistedFile(i))
    const session = sessionWith({ 'wt-1': files }, { 'wt-1': files[0].filePath })

    const kept = capRestoredOpenFilesByWorktree(session).openFilesByWorktree?.['wt-1'] ?? []

    expect(kept[0]?.filePath).toBe(files[0].filePath)
  })

  it('keeps the focused tab addressed by its owner-qualified id', () => {
    const total = MAX_RESTORED_OPEN_FILES_PER_WORKSPACE + 50
    const files = Array.from({ length: total }, (_, i) => persistedFile(i))
    const ownedId = `editor:wt-1:local:${encodeURIComponent(files[0].filePath)}`
    const session = sessionWith({ 'wt-1': files }, { 'wt-1': ownedId })

    const kept = capRestoredOpenFilesByWorktree(session).openFilesByWorktree?.['wt-1'] ?? []

    expect(kept[0]?.filePath).toBe(files[0].filePath)
  })

  it('caps each workspace independently and leaves untouched ones referentially stable', () => {
    const small = [persistedFile(1), persistedFile(2)]
    const large = Array.from({ length: MAX_RESTORED_OPEN_FILES_PER_WORKSPACE + 5 }, (_, i) =>
      persistedFile(i)
    )
    const session = sessionWith({ 'wt-small': small, 'wt-large': large })

    const capped = capRestoredOpenFilesByWorktree(session)

    expect(capped.openFilesByWorktree?.['wt-small']).toBe(small)
    expect(capped.openFilesByWorktree?.['wt-large']).toHaveLength(
      MAX_RESTORED_OPEN_FILES_PER_WORKSPACE
    )
  })

  it('tolerates a session with no persisted editor files', () => {
    const session = { activeFileIdByWorktree: {} } as unknown as WorkspaceSessionState

    expect(capRestoredOpenFilesByWorktree(session)).toBe(session)
  })
})
