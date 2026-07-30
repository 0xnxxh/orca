import { useCallback, useEffect, useRef, useState } from 'react'
import type { GitStatusResult, GlobalSettings, Repo } from '../../../../shared/types'
import type { WorkspaceSpaceWorktree } from '../../../../shared/workspace-space-types'
import { useAppStore } from '../../store'
import type { GitStatusRefreshDeps } from '../right-sidebar/git-status-refresh'
import { getWorkspaceSpaceGitStatusRefreshCandidates } from './workspace-space-presentation'
import {
  loadWorkspaceSpaceGitStatus,
  type WorkspaceSpaceGitStatusContext
} from './workspace-space-git-status-snapshot'

const GIT_STATUS_REFRESH_CONCURRENCY = 6

export type WorkspaceGitRefreshState = {
  isRefreshing: boolean
  error: string | null
}

type InFlightRefresh = {
  contextKey: string
  controller: AbortController
  promise: Promise<void>
}

function createContextKey(
  worktree: WorkspaceSpaceWorktree,
  connectionId: string | undefined,
  settings: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null | undefined
): string {
  return JSON.stringify([
    worktree.worktreeId,
    worktree.path,
    worktree.repoId,
    worktree.branch,
    connectionId ?? null,
    settings?.activeRuntimeEnvironmentId ?? null
  ])
}

export function useWorkspaceSpaceGitStatusRefresh({
  sourceRows,
  repoMap,
  settings,
  deps
}: {
  sourceRows: readonly WorkspaceSpaceWorktree[]
  repoMap: ReadonlyMap<string, Repo>
  settings: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null | undefined
  deps: GitStatusRefreshDeps
}): Record<string, WorkspaceGitRefreshState> {
  const [refreshState, setRefreshState] = useState<Record<string, WorkspaceGitRefreshState>>({})
  const inFlight = useRef<Map<string, InFlightRefresh>>(new Map())
  const isMounted = useRef(true)

  useEffect(() => {
    const refreshes = inFlight.current
    isMounted.current = true
    return () => {
      isMounted.current = false
      queueMicrotask(() => {
        if (isMounted.current) {
          return
        }
        for (const refresh of refreshes.values()) {
          refresh.controller.abort()
        }
        refreshes.clear()
      })
    }
  }, [])

  const refreshWorktree = useCallback(
    (worktree: WorkspaceSpaceWorktree): Promise<void> => {
      const initialState = useAppStore.getState()
      if (initialState.gitStatusByWorktree[worktree.worktreeId] !== undefined) {
        return Promise.resolve()
      }
      const connectionId = repoMap.get(worktree.repoId)?.connectionId ?? undefined
      const context: WorkspaceSpaceGitStatusContext = {
        settings,
        worktreeId: worktree.worktreeId,
        worktreePath: worktree.path,
        connectionId,
        expectedBranch: worktree.branch
      }
      const contextKey = createContextKey(worktree, connectionId, settings)
      const existing = inFlight.current.get(worktree.worktreeId)
      if (existing?.contextKey === contextKey && !existing.controller.signal.aborted) {
        return existing.promise
      }
      existing?.controller.abort()
      const controller = new AbortController()
      const shouldContinue = (): boolean => {
        if (!isMounted.current || controller.signal.aborted) {
          return false
        }
        const state = useAppStore.getState()
        const currentWorktree = state.workspaceSpaceAnalysis?.worktrees.find(
          (candidate) => candidate.worktreeId === worktree.worktreeId
        )
        const currentConnectionId =
          state.repos.find((repo) => repo.id === worktree.repoId)?.connectionId ?? undefined
        return (
          currentWorktree?.path === worktree.path &&
          currentWorktree.repoId === worktree.repoId &&
          currentWorktree.branch === worktree.branch &&
          currentConnectionId === connectionId &&
          (state.settings?.activeRuntimeEnvironmentId ?? null) ===
            (settings?.activeRuntimeEnvironmentId ?? null)
        )
      }
      const shouldStart = (): boolean =>
        shouldContinue() &&
        useAppStore.getState().gitStatusByWorktree[worktree.worktreeId] === undefined

      setRefreshState((current) => ({
        ...current,
        [worktree.worktreeId]: { isRefreshing: true, error: null }
      }))
      const promise = loadWorkspaceSpaceGitStatus({
        context,
        deps,
        request: { signal: controller.signal, shouldStart, shouldContinue }
      })
        .then(() => {
          if (shouldStart()) {
            deps.setGitStatus(worktree.worktreeId, {
              conflictOperation: 'unknown',
              entries: [],
              ignoredPaths: []
            } as GitStatusResult)
          }
          if (
            isMounted.current &&
            useAppStore.getState().gitStatusByWorktree[worktree.worktreeId] !== undefined
          ) {
            setRefreshState((current) => ({
              ...current,
              [worktree.worktreeId]: { isRefreshing: false, error: null }
            }))
          }
        })
        .catch((error: unknown) => {
          if (!shouldStart()) {
            return
          }
          setRefreshState((current) => ({
            ...current,
            [worktree.worktreeId]: {
              isRefreshing: false,
              error: error instanceof Error ? error.message : String(error)
            }
          }))
        })
        .finally(() => {
          const current = inFlight.current.get(worktree.worktreeId)
          if (current?.promise === promise) {
            inFlight.current.delete(worktree.worktreeId)
          }
        })
      inFlight.current.set(worktree.worktreeId, { contextKey, controller, promise })
      return promise
    },
    [deps, repoMap, settings]
  )

  useEffect(() => {
    const candidates = getWorkspaceSpaceGitStatusRefreshCandidates(sourceRows)
    let cancelled = false
    let nextIndex = 0
    const runWorker = async (): Promise<void> => {
      while (!cancelled) {
        const worktree = candidates[nextIndex]
        nextIndex += 1
        if (!worktree) {
          return
        }
        await refreshWorktree(worktree)
      }
    }
    const workerCount = Math.min(GIT_STATUS_REFRESH_CONCURRENCY, candidates.length)
    void Promise.all(Array.from({ length: workerCount }, () => runWorker()))
    return () => {
      cancelled = true
    }
  }, [refreshWorktree, sourceRows])

  return refreshState
}
