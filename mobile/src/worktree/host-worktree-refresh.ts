import { AppState } from 'react-native'
import type { RuntimeClientEventStreamMessage } from '../../../src/shared/runtime-client-events'
import type { RpcClient } from '../transport/rpc-client'

const WORKTREE_REFRESH_MS = 3000

export type WorktreeRefreshOptions = {
  allowDuringModal?: boolean
  onStarted?: () => void
}
type RepoRefreshOptions = { force?: boolean; queueIfInFlight?: boolean }

type HostWorktreeRefreshArgs = {
  client: RpcClient
  fetchWorktrees: (options?: WorktreeRefreshOptions) => Promise<void>
  fetchRepoMetadata: (options?: RepoRefreshOptions) => Promise<void>
}

export function startHostWorktreeRefresh({
  client,
  fetchWorktrees,
  fetchRepoMetadata
}: HostWorktreeRefreshArgs): () => void {
  let stale = false
  let eventStreamReady = false
  let worktreeRefreshTimer: ReturnType<typeof setTimeout> | null = null

  const scheduleWorktreeRefresh = (): void => {
    if (worktreeRefreshTimer) {
      clearTimeout(worktreeRefreshTimer)
    }
    worktreeRefreshTimer = setTimeout(() => {
      worktreeRefreshTimer = null
      if (AppState.currentState === 'active') {
        void fetchWorktrees()
      }
      scheduleWorktreeRefresh()
    }, WORKTREE_REFRESH_MS)
  }

  const refreshWorktrees = (options?: WorktreeRefreshOptions): void => {
    // Reset only after modal and in-flight guards admit the request.
    void fetchWorktrees({ ...options, onStarted: scheduleWorktreeRefresh })
  }

  const refreshOnForeground = (): void => {
    if (AppState.currentState !== 'active') {
      return
    }
    refreshWorktrees({ allowDuringModal: true })
    void fetchRepoMetadata({ queueIfInFlight: true })
  }

  const appStateSubscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      refreshOnForeground()
    }
  })
  const repoMetadataInterval = setInterval(() => {
    if (AppState.currentState !== 'active') {
      return
    }
    // Why: desktop Settings repo edits (icon/color/name, repo removal) notify only the
    // renderer IPC, not the runtime clientEvents stream, so `reposChanged` never reaches
    // mobile. Keep a periodic repo.list as the convergence safety-net; fetchRepoMetadata
    // self-throttles to REPO_METADATA_REFRESH_MS (60s), so this is ~1 request/min while
    // foregrounded — the AppState gate is what removes the waste (both stop while backgrounded).
    void fetchRepoMetadata()
  }, WORKTREE_REFRESH_MS)
  const unsubscribe = client.subscribe(
    'runtime.clientEvents.subscribe',
    null,
    (payload: unknown) => {
      if (stale || !payload || typeof payload !== 'object') {
        return
      }
      const event = payload as RuntimeClientEventStreamMessage | { type: 'error' }
      if (event.type === 'ready') {
        const replayedAfterReconnect = eventStreamReady
        eventStreamReady = true
        if (replayedAfterReconnect) {
          // Why: client events are not queued while disconnected, so re-read both snapshots after replay.
          refreshWorktrees()
          void fetchRepoMetadata({ force: true, queueIfInFlight: true })
        }
        return
      }
      if (event.type === 'end' || event.type === 'error') {
        eventStreamReady = false
        return
      }
      if (event.type === 'reposChanged') {
        void fetchRepoMetadata({ force: true, queueIfInFlight: true })
      } else if (event.type === 'worktreesChanged') {
        refreshWorktrees()
      }
    }
  )

  scheduleWorktreeRefresh()
  refreshWorktrees()
  void fetchRepoMetadata({ force: true, queueIfInFlight: true })

  return () => {
    stale = true
    if (worktreeRefreshTimer) {
      clearTimeout(worktreeRefreshTimer)
    }
    clearInterval(repoMetadataInterval)
    appStateSubscription.remove()
    unsubscribe()
  }
}
