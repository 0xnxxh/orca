import type { Dispatch, SetStateAction } from 'react'
import { useCallback, useRef, useState } from 'react'
import type { DirCache } from './file-explorer-types'
import { splitPathSegments } from './path-tree'
import { statRuntimePath } from '@/runtime/runtime-file-client'
import { createFileExplorerDirLoadTracker } from './file-explorer-dir-load-tracker'
import {
  getFileExplorerOperationOwner,
  getFileExplorerOwnerUnresolvedMessage,
  getFileExplorerOperationRoute
} from './file-explorer-operation-owner'
import {
  fileExplorerEntriesToTreeNodes,
  readFileExplorerDirectory
} from './file-explorer-directory-listing'
import { refreshFileExplorerExpandedDirs } from './file-explorer-expanded-dirs-refresh'
import { collectStaleDirCachePaths } from './file-explorer-stale-dir-cache'
import { fileExplorerRefreshConcurrency } from './file-explorer-refresh-concurrency'

type UseFileExplorerTreeResult = {
  dirCache: Record<string, DirCache>
  setDirCache: Dispatch<SetStateAction<Record<string, DirCache>>>
  rootCache: DirCache | undefined
  rootError: string | null
  loadDir: (
    dirPath: string,
    depth: number,
    options?: { force?: boolean; failOnError?: boolean }
  ) => Promise<boolean>
  statPath: (path: string) => Promise<{ isDirectory: boolean }>
  markPathAsDirectory: (path: string) => void
  refreshTree: () => Promise<void>
  refreshDir: (dirPath: string) => Promise<void>
  /** True while a dir's cached listing predates the last full refresh that skipped it. */
  isDirStale: (dirPath: string) => boolean
  resetAndLoad: () => void
}

export function useFileExplorerTree(
  worktreePath: string | null,
  expanded: Set<string>,
  activeWorktreeId?: string | null
): UseFileExplorerTreeResult {
  const [dirCache, setDirCache] = useState<Record<string, DirCache>>({})
  const [rootError, setRootError] = useState<string | null>(null)
  const dirCacheRef = useRef(dirCache)
  dirCacheRef.current = dirCache
  const dirLoadTrackerRef = useRef(createFileExplorerDirLoadTracker())
  // Why: a ref, not state — the expansion effect must read the mark set by a refresh that landed
  // after the effect's render, and a state write would only be visible one render too late.
  const staleDirsRef = useRef(new Set<string>())
  const expandedRef = useRef(expanded)
  expandedRef.current = expanded

  const loadDir = useCallback(
    async (
      dirPath: string,
      depth: number,
      options?: { force?: boolean; failOnError?: boolean }
    ) => {
      const cache = dirCacheRef.current
      if (!options?.force && (cache[dirPath]?.children.length > 0 || cache[dirPath]?.loading)) {
        return true
      }
      const loadToken = dirLoadTrackerRef.current.begin(dirPath)
      // Why: this read starts after the refresh that marked the dir, so its result is current.
      staleDirsRef.current.delete(dirPath)
      // Why: when force-reloading a directory (e.g. after a file is created,
      // duplicated, or deleted), keep the previous children visible while the
      // fresh listing loads. Clearing to [] would momentarily shrink the
      // visible projection and make the virtualizer jump to the top.
      setDirCache((prev) => ({
        ...prev,
        [dirPath]: {
          children: prev[dirPath]?.children ?? [],
          loading: true
        }
      }))
      try {
        const listing = await readFileExplorerDirectory(activeWorktreeId, worktreePath, dirPath)
        if (!dirLoadTrackerRef.current.isCurrent(loadToken)) {
          return false
        }
        if (depth === -1) {
          setRootError(null)
        }
        const children = fileExplorerEntriesToTreeNodes(
          listing.entries,
          dirPath,
          depth,
          worktreePath,
          listing.operationOwner
        )
        setDirCache((prev) => ({
          ...prev,
          [dirPath]: { children, loading: false, operationOwner: listing.operationOwner }
        }))
        return true
      } catch (error) {
        if (!dirLoadTrackerRef.current.isCurrent(loadToken)) {
          return false
        }
        if (depth === -1) {
          // Why: the old implementation collapsed root read failures into an
          // empty tree, which made authorization/path bugs look like a real
          // empty worktree. Preserve the message so the UI can distinguish
          // "no files" from "could not read this worktree".
          setRootError(error instanceof Error ? error.message : String(error))
        }
        setDirCache((prev) => ({ ...prev, [dirPath]: { children: [], loading: false } }))
        return !options?.failOnError
      }
    },
    [activeWorktreeId, worktreePath]
  )

  const markPathAsDirectory = useCallback((path: string) => {
    setDirCache((prev) => {
      let changed = false
      const next: Record<string, DirCache> = {}
      for (const [dirPath, cache] of Object.entries(prev)) {
        let cacheChanged = false
        const children = cache.children.map((child) => {
          if (child.path !== path || child.isDirectory) {
            return child
          }
          changed = true
          cacheChanged = true
          return { ...child, isDirectory: true }
        })
        next[dirPath] = cacheChanged ? { ...cache, children } : cache
      }
      return changed ? next : prev
    })
  }, [])

  const statPath = useCallback(
    async (path: string) => {
      const operationOwner = getFileExplorerOperationOwner(activeWorktreeId)
      const route = getFileExplorerOperationRoute(operationOwner)
      if (!route) {
        throw new Error(getFileExplorerOwnerUnresolvedMessage())
      }
      return statRuntimePath(
        {
          settings: route.settings,
          worktreeId: activeWorktreeId,
          worktreePath,
          connectionId: route.connectionId
        },
        path
      )
    },
    [activeWorktreeId, worktreePath]
  )

  const refreshTree = useCallback(async () => {
    if (!worktreePath) {
      return
    }
    // Why: clearing the entire dirCache here would momentarily empty the
    // visible projection and jump the virtualizer to the top. Instead we rely
    // on force-reload keeping existing children visible until fresh data lands.
    // Why: mark before the first read, against the live expanded set — a dir expanded after this
    // point loads through the expansion effect, which would otherwise trust a listing this refresh
    // never re-read. Replacing (not merging) also clears dirs this refresh does cover.
    staleDirsRef.current = new Set(
      collectStaleDirCachePaths(dirCacheRef.current, worktreePath, expandedRef.current)
    )
    const refreshSession = dirLoadTrackerRef.current.getSession()
    const rootLoadCompleted = await loadDir(worktreePath, -1, { force: true })
    if (!rootLoadCompleted || !dirLoadTrackerRef.current.isSessionCurrent(refreshSession)) {
      return
    }
    // Why: root (worktreePath) was just force-loaded above; exclude it here so
    // refreshFileExplorerExpandedDirs doesn't queue a duplicate read of root.
    const expandedDirs = Array.from(expanded)
      .filter((dirPath) => dirPath !== worktreePath)
      .map((dirPath) => ({
        dirPath,
        depth: splitPathSegments(dirPath.slice(worktreePath.length + 1)).length - 1
      }))
    await refreshFileExplorerExpandedDirs({
      dirs: expandedDirs,
      worktreePath,
      dirLoadTracker: dirLoadTrackerRef.current,
      setDirCache,
      readDirectory: (dirPath) =>
        readFileExplorerDirectory(activeWorktreeId, worktreePath, dirPath),
      maxConcurrentReads: fileExplorerRefreshConcurrency(
        getFileExplorerOperationOwner(activeWorktreeId)
      )
    })
  }, [activeWorktreeId, expanded, loadDir, worktreePath])

  const refreshDir = useCallback(
    async (dirPath: string) => {
      if (!worktreePath) {
        return
      }
      const depth =
        dirPath === worktreePath
          ? -1
          : splitPathSegments(dirPath.slice(worktreePath.length + 1)).length - 1
      await loadDir(dirPath, depth, { force: true })
    },
    [worktreePath, loadDir]
  )

  const isDirStale = useCallback((dirPath: string) => staleDirsRef.current.has(dirPath), [])

  const rootCache = worktreePath ? dirCache[worktreePath] : undefined

  const resetAndLoad = useCallback(() => {
    // Why: stale readDir responses from the previous worktree/reset session
    // must not repopulate the explorer after the tree has been cleared.
    dirLoadTrackerRef.current.reset()
    staleDirsRef.current.clear()
    setDirCache({})
    setRootError(null)
    if (worktreePath) {
      void loadDir(worktreePath, -1, { force: true })
    }
  }, [worktreePath, loadDir])

  return {
    dirCache,
    setDirCache,
    rootCache,
    rootError,
    loadDir,
    statPath,
    markPathAsDirectory,
    refreshTree,
    refreshDir,
    isDirStale,
    resetAndLoad
  }
}
