import { useEffect, useRef } from 'react'
import type { SshConnectionState } from '../../../../shared/ssh-types'
import type { GitPushTarget, GitUpstreamStatus, GlobalSettings } from '../../../../shared/types'
import { getRuntimeGitRepositorySnapshot } from '@/runtime/runtime-git-repository-snapshot-client'
import {
  loadSourceControlAutomaticUpstream,
  type SourceControlAutomaticUpstreamContext
} from './source-control-automatic-upstream-snapshot'

type FetchUpstreamStatus = (
  worktreeId: string,
  worktreePath: string,
  connectionId?: string,
  pushTarget?: GitPushTarget,
  options?: {
    runtimeTargetSettings?: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null
    applyUpstreamStatus?: boolean
  }
) => Promise<GitUpstreamStatus | null>

type InFlightLoad = {
  contextKey: string
  controller: AbortController
  promise: Promise<void>
}

function pushTargetKey(pushTarget: GitPushTarget | undefined): unknown {
  if (!pushTarget) {
    return null
  }
  return {
    remoteName: pushTarget.remoteName,
    branchName: pushTarget.branchName,
    remoteUrl: pushTarget.remoteUrl ?? null,
    remoteCreated: Object.prototype.hasOwnProperty.call(pushTarget, 'remoteCreated')
      ? pushTarget.remoteCreated
      : 'absent'
  }
}

function buildContext(input: {
  enabled: boolean
  settings: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null | undefined
  worktreeId: string | null
  worktreePath: string | null
  connectionId: string | null
  sshConnectionState: Pick<SshConnectionState, 'providerEpoch' | 'connectionGeneration'> | null
  branch: string
  pushTarget?: GitPushTarget
}): { context: SourceControlAutomaticUpstreamContext; key: string } | null {
  if (!input.enabled || !input.worktreeId || !input.worktreePath) {
    return null
  }
  const context = {
    settings: input.settings,
    worktreeId: input.worktreeId,
    worktreePath: input.worktreePath,
    ...(input.connectionId ? { connectionId: input.connectionId } : {}),
    branch: input.branch,
    ...(input.pushTarget ? { pushTarget: input.pushTarget } : {})
  }
  return {
    context,
    key: JSON.stringify([
      input.worktreeId,
      input.worktreePath,
      input.branch,
      input.connectionId,
      input.sshConnectionState?.providerEpoch ?? null,
      input.sshConnectionState?.connectionGeneration ?? null,
      input.settings?.activeRuntimeEnvironmentId ?? null,
      pushTargetKey(input.pushTarget)
    ])
  }
}

export function useSourceControlAutomaticUpstreamSnapshot(input: {
  enabled: boolean
  settings: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null | undefined
  worktreeId: string | null
  worktreePath: string | null
  connectionId: string | null
  sshConnectionState: Pick<SshConnectionState, 'providerEpoch' | 'connectionGeneration'> | null
  branch: string
  pushTarget?: GitPushTarget
  fetchUpstreamStatus: FetchUpstreamStatus
  setUpstreamStatus: (worktreeId: string, status: GitUpstreamStatus) => void
}): void {
  const current = buildContext(input)
  const currentKeyRef = useRef<string | null>(current?.key ?? null)
  currentKeyRef.current = current?.key ?? null
  const latestRef = useRef({ current, input })
  latestRef.current = { current, input }
  const mountedRef = useRef(true)
  const inFlightRef = useRef<InFlightLoad | null>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      queueMicrotask(() => {
        if (!mountedRef.current) {
          inFlightRef.current?.controller.abort()
          inFlightRef.current = null
        }
      })
    }
  }, [])

  useEffect(() => {
    const latest = latestRef.current
    if (!latest.current) {
      inFlightRef.current?.controller.abort()
      inFlightRef.current = null
      return
    }
    const { context, key } = latest.current
    const existing = inFlightRef.current
    if (existing?.contextKey === key && !existing.controller.signal.aborted) {
      return
    }
    existing?.controller.abort()
    const controller = new AbortController()
    const shouldApply = (): boolean =>
      mountedRef.current && !controller.signal.aborted && currentKeyRef.current === key
    const promise = loadSourceControlAutomaticUpstream({
      context,
      request: { signal: controller.signal, shouldApply },
      dependencies: {
        getSnapshot: getRuntimeGitRepositorySnapshot,
        fetchFresh: () =>
          latest.input.fetchUpstreamStatus(
            context.worktreeId,
            context.worktreePath,
            context.connectionId,
            context.pushTarget,
            {
              runtimeTargetSettings: context.settings,
              applyUpstreamStatus: false
            }
          ),
        apply: (upstream) => latest.input.setUpstreamStatus(context.worktreeId, upstream)
      }
    })
      .catch(() => undefined)
      .then(() => undefined)
      .finally(() => {
        if (inFlightRef.current?.promise === promise) {
          inFlightRef.current = null
        }
      })
    inFlightRef.current = { contextKey: key, controller, promise }
  }, [current?.key])
}
