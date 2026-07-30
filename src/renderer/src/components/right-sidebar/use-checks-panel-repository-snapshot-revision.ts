import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GitPushTarget } from '../../../../shared/types'
import {
  subscribeDesktopGitRepositorySnapshot,
  type DesktopGitRepositorySnapshotContext
} from '@/runtime/desktop-git-repository-snapshot-client'
import { getRuntimeGitRepositorySnapshotRevisionTargetKey } from '@/runtime/runtime-git-repository-snapshot-revision-client'
import { ChecksPanelRepositorySnapshotRevisionGate } from './checks-panel-repository-snapshot-revision-gate'
import {
  ChecksPanelRuntimeRepositorySnapshotRevisions,
  checksPanelRepositorySnapshotPushTargetKey
} from './checks-panel-runtime-repository-snapshot-revisions'

type Input = {
  context: DesktopGitRepositorySnapshotContext
  contextKey: string
  enabled: boolean
  runtimeEnabled?: boolean
  pushTarget: GitPushTarget | null
  requestRefresh: () => void
}

export function useChecksPanelRepositorySnapshotRevision(input: Input): {
  beginRead: () => number
  finishRead: (
    read: number,
    observedRevision: number | null,
    admittedRuntimeSnapshot?: boolean
  ) => boolean
  isReadCurrent: (read: number) => boolean
  runtimeSnapshotPollingRequired: boolean
} {
  const { context, contextKey, enabled, pushTarget, requestRefresh, runtimeEnabled = false } = input
  const gateRef = useRef(new ChecksPanelRepositorySnapshotRevisionGate())
  const runtimeSessionRef = useRef<ChecksPanelRuntimeRepositorySnapshotRevisions | null>(null)
  const unsupportedRuntimeKeyRef = useRef<string | null>(null)
  const requestRefreshRef = useRef(requestRefresh)
  const previousRuntimeEnabledRef = useRef(runtimeEnabled)
  const runtimeActivationRef = useRef(0)
  if (previousRuntimeEnabledRef.current !== runtimeEnabled) {
    previousRuntimeEnabledRef.current = runtimeEnabled
    runtimeActivationRef.current += 1
  }
  requestRefreshRef.current = requestRefresh
  const [runtimeReadyKey, setRuntimeReadyKey] = useState<string | null>(null)
  const runtimeTargetKey = getRuntimeGitRepositorySnapshotRevisionTargetKey(context)
  const runtimeStreamKey =
    runtimeEnabled && runtimeTargetKey
      ? JSON.stringify([
          runtimeActivationRef.current,
          contextKey,
          runtimeTargetKey,
          checksPanelRepositorySnapshotPushTargetKey(pushTarget)
        ])
      : null

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

  useEffect(() => {
    if (!runtimeStreamKey) {
      return undefined
    }
    if (unsupportedRuntimeKeyRef.current && unsupportedRuntimeKeyRef.current !== runtimeStreamKey) {
      unsupportedRuntimeKeyRef.current = null
    }
    if (unsupportedRuntimeKeyRef.current === runtimeStreamKey) {
      return undefined
    }
    const existing = runtimeSessionRef.current
    const session =
      existing?.key === runtimeStreamKey && !existing.isClosed
        ? existing
        : new ChecksPanelRuntimeRepositorySnapshotRevisions(runtimeStreamKey, context, pushTarget, {
            onReady: (event) => {
              if (gateRef.current.observe(event)) {
                requestRefreshRef.current()
              }
            },
            onInvalidated: (event) => {
              setRuntimeReadyKey((key) => (key === runtimeStreamKey ? null : key))
              gateRef.current.observe(event)
            },
            onReplay: () => {
              setRuntimeReadyKey((key) => (key === runtimeStreamKey ? null : key))
              gateRef.current.reset()
            },
            onUnavailable: (error) => {
              unsupportedRuntimeKeyRef.current = runtimeStreamKey
              setRuntimeReadyKey((key) => (key === runtimeStreamKey ? null : key))
              gateRef.current.reset()
              console.warn(
                '[ChecksPanel] runtime repository snapshot subscription unavailable',
                error
              )
            }
          })
    if (existing && existing !== session) {
      existing.close()
    }
    runtimeSessionRef.current = session
    session.retain()
    return () => {
      session.releaseAfterTurn(() => {
        if (runtimeSessionRef.current === session) {
          runtimeSessionRef.current = null
        }
      })
    }
  }, [context, pushTarget, runtimeStreamKey])

  const beginRead = useCallback((): number => {
    const read = gateRef.current.begin()
    runtimeSessionRef.current?.beginRead(read)
    return read
  }, [])
  const isReadCurrent = useCallback((read: number): boolean => gateRef.current.isCurrent(read), [])
  const finishRead = useCallback(
    (read: number, observedRevision: number | null, admittedRuntimeSnapshot = false): boolean => {
      const shouldRerun = gateRef.current.finish(read, observedRevision)
      const session = runtimeSessionRef.current
      if (session) {
        if (session.finishRead(read, admittedRuntimeSnapshot)) {
          setRuntimeReadyKey(session.key)
        }
      }
      return shouldRerun
    },
    []
  )
  const runtimeSnapshotPollingRequired =
    runtimeStreamKey === null || runtimeReadyKey !== runtimeStreamKey

  return useMemo(
    () => ({ beginRead, finishRead, isReadCurrent, runtimeSnapshotPollingRequired }),
    [beginRead, finishRead, isReadCurrent, runtimeSnapshotPollingRequired]
  )
}
