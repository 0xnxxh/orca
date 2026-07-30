import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { GitPushTarget } from '../../../../shared/types'
import {
  subscribeDesktopGitRepositorySnapshot,
  type DesktopGitRepositorySnapshotContext
} from '@/runtime/desktop-git-repository-snapshot-client'
import { ChecksPanelRepositorySnapshotRevisionGate } from './checks-panel-repository-snapshot-revision-gate'

type Input = {
  context: DesktopGitRepositorySnapshotContext
  contextKey: string
  enabled: boolean
  pushTarget: GitPushTarget | null
  requestRefresh: () => void
}

export function useChecksPanelRepositorySnapshotRevision(input: Input): {
  beginRead: () => number
  finishRead: (read: number, observedRevision: number | null) => boolean
} {
  const { context, contextKey, enabled, pushTarget, requestRefresh } = input
  const gateRef = useRef(new ChecksPanelRepositorySnapshotRevisionGate())

  useEffect(() => {
    const gate = gateRef.current
    gate.reset()
    if (!enabled) {
      return undefined
    }
    let stale = false
    const handles: { unsubscribe: () => void }[] = []
    const subscribe = async (): Promise<void> => {
      const options = pushTarget ? { pushTarget } : {}
      const callback = (event: Parameters<typeof gate.observe>[0]): void => {
        if (!stale && gate.observe(event)) {
          requestRefresh()
        }
      }
      const retain = async (
        request: ReturnType<typeof subscribeDesktopGitRepositorySnapshot>
      ): Promise<void> => {
        const handle = await request
        if (!handle) {
          return
        }
        if (stale) {
          handle.unsubscribe()
          return
        }
        handles.push(handle)
      }
      const settled = await Promise.allSettled([
        retain(subscribeDesktopGitRepositorySnapshot(context, options, callback)),
        retain(
          subscribeDesktopGitRepositorySnapshot(
            context,
            { ...options, reuseLineStats: true },
            callback
          )
        )
      ])
      const rejected = settled.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected'
      )
      if (rejected) {
        for (const handle of handles.splice(0)) {
          handle.unsubscribe()
        }
        throw rejected.reason
      }
    }
    void subscribe().catch((error) => {
      if (!stale) {
        console.warn('[ChecksPanel] repository snapshot subscription failed', error)
      }
    })
    return () => {
      stale = true
      for (const handle of handles) {
        handle.unsubscribe()
      }
      gate.reset()
    }
  }, [context, contextKey, enabled, pushTarget, requestRefresh])

  const beginRead = useCallback((): number => gateRef.current.begin(), [])
  const finishRead = useCallback(
    (read: number, observedRevision: number | null): boolean =>
      gateRef.current.finish(read, observedRevision),
    []
  )

  return useMemo(() => ({ beginRead, finishRead }), [beginRead, finishRead])
}
