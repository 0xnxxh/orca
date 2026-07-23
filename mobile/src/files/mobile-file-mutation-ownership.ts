import { parseExecutionHostId } from '../../../src/shared/execution-host'
import {
  assertFileMutationOwnershipCapability,
  buildFileMutationOwnership,
  FILE_MUTATION_OWNER_UNVERIFIED_MESSAGE,
  type FileMutationOwnership
} from '../../../src/shared/file-mutation-ownership'
import type { RuntimeStatus } from '../../../src/shared/runtime-types'
import type { SshConnectionState } from '../../../src/shared/ssh-types'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcFailure, RpcSuccess } from '../transport/types'

const FILE_MUTATION_TIMEOUT_MS = 15_000
export const MOBILE_WORKTREE_NOT_FOUND_MESSAGE =
  'This workspace is no longer available. Return to the workspace list and try again.'

export type MobileFileMutationOwnership = FileMutationOwnership

export function getMobileFileMutationFailureMessage(failure: RpcFailure): string {
  if (
    failure.error.code === 'selector_not_found' ||
    failure.error.message === 'selector_not_found'
  ) {
    return MOBILE_WORKTREE_NOT_FOUND_MESSAGE
  }
  return failure.error.message || 'Failed to update workspace files'
}

export const buildMobileFileMutationOwnership = buildFileMutationOwnership

export async function captureMobileFileMutationOwnership(
  client: Pick<RpcClient, 'sendRequest'>,
  worktree: string
): Promise<MobileFileMutationOwnership> {
  const status = await requestResult<Pick<RuntimeStatus, 'capabilities'>>(
    client,
    'status.get',
    undefined
  )
  assertFileMutationOwnershipCapability(status)

  const result = await requestResult<{ worktree?: { hostId?: string | null } }>(
    client,
    'worktree.show',
    { worktree }
  )
  if (!result.worktree) {
    throw new Error(FILE_MUTATION_OWNER_UNVERIFIED_MESSAGE)
  }

  const host = parseExecutionHostId(result.worktree.hostId)
  const sshState =
    host?.kind === 'ssh'
      ? (
          await requestResult<{ state: SshConnectionState | null }>(client, 'ssh.getState', {
            targetId: host.targetId
          })
        ).state
      : null
  return buildMobileFileMutationOwnership(result.worktree.hostId, sshState)
}

async function requestResult<TResult>(
  client: Pick<RpcClient, 'sendRequest'>,
  method: string,
  params: unknown
): Promise<TResult> {
  const response = await client.sendRequest(method, params, {
    timeoutMs: FILE_MUTATION_TIMEOUT_MS
  })
  if (!response.ok) {
    throw new Error(getMobileFileMutationFailureMessage(response as RpcFailure))
  }
  return (response as RpcSuccess).result as TResult
}
