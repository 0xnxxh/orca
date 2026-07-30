import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState, RpcSuccess } from '../transport/types'
import { readMobileSourceControlRepositorySnapshot } from './mobile-git-repository-snapshot'
import {
  isMobileGitUnavailable,
  isMobileGitTransientRefreshError,
  type MobileGitStatusResult
} from './mobile-git-status'

const SELECTOR_RETRY_COUNT = 3
const SELECTOR_RETRY_DELAY_MS = 250

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export type MobileSourceControlStatusReadResult =
  | { kind: 'ready'; status: MobileGitStatusResult }
  | { kind: 'unavailable' }
  | { kind: 'cancelled' }

type StatusReadInput = {
  client: RpcClient
  worktreeId: string
  preferRepositorySnapshot: boolean
  isCurrent: () => boolean
}

export type MobileSourceControlStatusLoadContext = {
  client: RpcClient | null
  connState: ConnectionState
  statusIdentityKey: string
}

export function isMobileSourceControlStatusLoadContextCurrent(
  captured: MobileSourceControlStatusLoadContext,
  current: MobileSourceControlStatusLoadContext
): boolean {
  return (
    captured.client === current.client &&
    captured.connState === current.connState &&
    captured.statusIdentityKey === current.statusIdentityKey
  )
}

export async function readMobileSourceControlStatus(
  input: StatusReadInput
): Promise<MobileSourceControlStatusReadResult> {
  const selector = { worktree: `id:${input.worktreeId}` }
  if (input.preferRepositorySnapshot) {
    try {
      const response = await input.client.sendRequest('git.repositorySnapshot', selector)
      if (!input.isCurrent()) {
        return { kind: 'cancelled' }
      }
      const status = response.ok ? readMobileSourceControlRepositorySnapshot(response.result) : null
      if (status) {
        return { kind: 'ready', status }
      }
    } catch {
      if (!input.isCurrent()) {
        return { kind: 'cancelled' }
      }
    }
  }

  for (let attempt = 0; attempt <= SELECTOR_RETRY_COUNT; attempt += 1) {
    const response = await input.client.sendRequest('git.status', selector)
    if (!input.isCurrent()) {
      return { kind: 'cancelled' }
    }
    if (response.ok) {
      return {
        kind: 'ready',
        status: (response as RpcSuccess).result as MobileGitStatusResult
      }
    }
    if (isMobileGitUnavailable(response.error?.code, response.error?.message)) {
      return { kind: 'unavailable' }
    }
    const shouldRetry =
      response.error?.code === 'selector_not_found' ||
      isMobileGitTransientRefreshError(response.error?.code, response.error?.message)
    if (shouldRetry && attempt < SELECTOR_RETRY_COUNT) {
      await wait(SELECTOR_RETRY_DELAY_MS)
      if (!input.isCurrent()) {
        return { kind: 'cancelled' }
      }
      continue
    }
    throw new Error(response.error?.message || 'Unable to load source control')
  }
  throw new Error('Unable to load source control')
}
