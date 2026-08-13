import { useCallback, useEffect, useMemo, useState } from 'react'
import { getConnectionId } from '@/lib/connection-context'
import {
  bulkStageRuntimeGitPaths,
  bulkUnstageRuntimeGitPaths,
  type RuntimeGitContext
} from '@/runtime/runtime-git-client'
import { getStageAllPaths, isStageableStatusEntry } from './discard-all-sequence'
import type { SourceControlEntryGroups } from './source-control-section-order'
import type { FlatEntry } from './useSourceControlSelection'

export function useSourceControlBulkActions({
  selectedKeys,
  flatEntriesByKey,
  activeRepoSettings,
  activeWorktreeId,
  worktreePath,
  grouped,
  clearSelection,
  refreshActiveGitStatusAfterMutation
}: {
  selectedKeys: ReadonlySet<string>
  flatEntriesByKey: ReadonlyMap<string, FlatEntry>
  activeRepoSettings: RuntimeGitContext['settings']
  activeWorktreeId: string | null
  worktreePath: string | null
  grouped: SourceControlEntryGroups
  clearSelection: () => void
  refreshActiveGitStatusAfterMutation: () => Promise<void>
}) {
  const [isExecutingBulk, setIsExecutingBulk] = useState(false)
  useEffect(() => setIsExecutingBulk(false), [activeWorktreeId])
  const selectedEntries = useMemo(
    () =>
      Array.from(selectedKeys)
        .map((key) => flatEntriesByKey.get(key))
        .filter((entry): entry is FlatEntry => Boolean(entry)),
    [selectedKeys, flatEntriesByKey]
  )

  const bulkStagePaths = useMemo(
    () =>
      selectedEntries
        .filter((entry) => isStageableStatusEntry(entry.entry))
        .map((entry) => entry.entry.path),
    [selectedEntries]
  )

  const bulkUnstagePaths = useMemo(
    () =>
      selectedEntries
        // Why: submodule-internal rows are read-only from the parent worktree.
        .filter((entry) => entry.area === 'staged' && !entry.entry.submoduleRoot)
        .map((entry) => entry.entry.path),
    [selectedEntries]
  )

  const selectedKeySet = selectedKeys

  const handleBulkStage = useCallback(async () => {
    if (!worktreePath || bulkStagePaths.length === 0) {
      return
    }
    setIsExecutingBulk(true)
    try {
      const connectionId = getConnectionId(activeWorktreeId ?? null) ?? undefined
      await bulkStageRuntimeGitPaths(
        {
          // Why: route staging by the repo OWNER host, not the focused runtime.
          settings: activeRepoSettings,
          worktreeId: activeWorktreeId,
          worktreePath,
          connectionId
        },
        bulkStagePaths
      )
      await refreshActiveGitStatusAfterMutation()
      clearSelection()
    } finally {
      setIsExecutingBulk(false)
    }
  }, [
    activeRepoSettings,
    worktreePath,
    bulkStagePaths,
    clearSelection,
    activeWorktreeId,
    refreshActiveGitStatusAfterMutation
  ])

  const handleBulkUnstage = useCallback(async () => {
    if (!worktreePath || bulkUnstagePaths.length === 0) {
      return
    }
    setIsExecutingBulk(true)
    try {
      const connectionId = getConnectionId(activeWorktreeId ?? null) ?? undefined
      await bulkUnstageRuntimeGitPaths(
        {
          // Why: route unstaging by the repo OWNER host, not the focused runtime.
          settings: activeRepoSettings,
          worktreeId: activeWorktreeId,
          worktreePath,
          connectionId
        },
        bulkUnstagePaths
      )
      await refreshActiveGitStatusAfterMutation()
      clearSelection()
    } finally {
      setIsExecutingBulk(false)
    }
  }, [
    activeRepoSettings,
    worktreePath,
    bulkUnstagePaths,
    clearSelection,
    activeWorktreeId,
    refreshActiveGitStatusAfterMutation
  ])

  const handleStageAllPaths = useCallback(
    async (paths: readonly string[]) => {
      if (!worktreePath || isExecutingBulk || paths.length === 0) {
        return
      }
      setIsExecutingBulk(true)
      try {
        const connectionId = getConnectionId(activeWorktreeId ?? null) ?? undefined
        await bulkStageRuntimeGitPaths(
          {
            // Why: route staging by the repo OWNER host, not the focused runtime.
            settings: activeRepoSettings,
            worktreeId: activeWorktreeId,
            worktreePath,
            connectionId
          },
          [...paths]
        )
        await refreshActiveGitStatusAfterMutation()
        clearSelection()
      } finally {
        setIsExecutingBulk(false)
      }
    },
    [
      activeRepoSettings,
      activeWorktreeId,
      clearSelection,
      isExecutingBulk,
      refreshActiveGitStatusAfterMutation,
      worktreePath
    ]
  )

  const handleUnstagePaths = useCallback(
    async (paths: readonly string[]) => {
      if (!worktreePath || isExecutingBulk || paths.length === 0) {
        return
      }
      setIsExecutingBulk(true)
      try {
        const connectionId = getConnectionId(activeWorktreeId ?? null) ?? undefined
        await bulkUnstageRuntimeGitPaths(
          {
            // Why: route unstaging by the repo OWNER host, not the focused runtime.
            settings: activeRepoSettings,
            worktreeId: activeWorktreeId,
            worktreePath,
            connectionId
          },
          [...paths]
        )
        await refreshActiveGitStatusAfterMutation()
        clearSelection()
      } finally {
        setIsExecutingBulk(false)
      }
    },
    [
      activeRepoSettings,
      activeWorktreeId,
      clearSelection,
      isExecutingBulk,
      refreshActiveGitStatusAfterMutation,
      worktreePath
    ]
  )

  // Why: bypasses handleActionInvoke because that handler is typed to DropdownActionKind and 'stage' is intentionally not in the dropdown union.
  const handleStageAllPrimary = useCallback(async (): Promise<void> => {
    if (!worktreePath || isExecutingBulk) {
      return
    }
    const filePaths = [
      ...getStageAllPaths(grouped.unstaged, 'unstaged'),
      ...getStageAllPaths(grouped.untracked, 'untracked')
    ]
    if (filePaths.length === 0) {
      return
    }
    setIsExecutingBulk(true)
    try {
      const connectionId = getConnectionId(activeWorktreeId ?? null) ?? undefined
      await bulkStageRuntimeGitPaths(
        {
          // Why: route staging by the repo OWNER host, not the focused runtime.
          settings: activeRepoSettings,
          worktreeId: activeWorktreeId,
          worktreePath,
          connectionId
        },
        filePaths
      )
      await refreshActiveGitStatusAfterMutation()
      clearSelection()
    } finally {
      setIsExecutingBulk(false)
    }
  }, [
    activeRepoSettings,
    worktreePath,
    isExecutingBulk,
    grouped,
    activeWorktreeId,
    clearSelection,
    refreshActiveGitStatusAfterMutation
  ])

  return {
    isExecutingBulk,
    setIsExecutingBulk,
    bulkStagePaths,
    bulkUnstagePaths,
    selectedKeySet,
    handleBulkStage,
    handleBulkUnstage,
    handleStageAllPaths,
    handleUnstagePaths,
    handleStageAllPrimary
  }
}
