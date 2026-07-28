// @vitest-environment happy-dom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MobileWebSourceControlSyncResult } from '../../shared/mobile-web/source-control-sync-contract'
import type { MobileWebBridgeClient } from './mobile-web-bridge-client'
import { useMobileWebSourceControlSync } from './use-mobile-web-source-control-sync'

afterEach(cleanup)

describe('useMobileWebSourceControlSync', () => {
  it('cancels and ignores an action when the bridge client is replaced', async () => {
    await verifyReplacementCancellation('client')
  })

  it('cancels and ignores an action when the workspace is replaced', async () => {
    await verifyReplacementCancellation('workspace')
  })
})

async function verifyReplacementCancellation(replacement: 'client' | 'workspace') {
  const action = deferred<MobileWebSourceControlSyncResult>()
  const first = syncClient(action.promise)
  const second = replacement === 'client' ? syncClient() : first
  const onRepositoryChanged = vi.fn()
  const hook = renderHook(
    ({ client, workspaceId }) =>
      useMobileWebSourceControlSync({
        client,
        workspaceId,
        connected: true,
        onRepositoryChanged
      }),
    {
      initialProps: {
        client: first as unknown as MobileWebBridgeClient,
        workspaceId: 'workspace-1'
      }
    }
  )
  await waitFor(() => expect(hook.result.current.repository?.workspaceId).toBe('workspace-1'))

  let request = Promise.resolve(false)
  act(() => {
    request = hook.result.current.fetch()
  })
  const signal = first.sourceControlFetch.mock.calls[0]?.[1]?.signal as AbortSignal
  expect(signal.aborted).toBe(false)

  hook.rerender({
    client: second as unknown as MobileWebBridgeClient,
    workspaceId: replacement === 'workspace' ? 'workspace-2' : 'workspace-1'
  })
  await waitFor(() => expect(signal.aborted).toBe(true))
  action.resolve(actionResult('workspace-1'))

  await expect(request).resolves.toBe(false)
  expect(onRepositoryChanged).not.toHaveBeenCalled()
  await waitFor(() =>
    expect(hook.result.current.repository?.workspaceId).toBe(
      replacement === 'workspace' ? 'workspace-2' : 'workspace-1'
    )
  )
}

function syncClient(fetchResult?: Promise<MobileWebSourceControlSyncResult>) {
  return {
    sourceControlUpstream: vi
      .fn()
      .mockImplementation(({ workspaceId }) => Promise.resolve(repositoryState(workspaceId))),
    sourceControlFetch: vi
      .fn()
      .mockImplementation(
        ({ workspaceId }) => fetchResult ?? Promise.resolve(actionResult(workspaceId))
      )
  }
}

function repositoryState(workspaceId: string) {
  return {
    workspaceId,
    head: 'a'.repeat(40),
    branch: 'main',
    conflictOperation: 'unknown' as const,
    baseRef: 'origin/main',
    upstream: {
      hasUpstream: true,
      upstreamName: 'origin/main',
      ahead: 0,
      behind: 0,
      hasConfiguredPushTarget: false,
      behindCommitsArePatchEquivalent: false
    }
  }
}

function actionResult(workspaceId: string): MobileWebSourceControlSyncResult {
  return {
    workspaceId,
    operation: 'fetch',
    previousHead: 'a'.repeat(40),
    previousBranch: 'main',
    repository: repositoryState(workspaceId),
    completed: true
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}
