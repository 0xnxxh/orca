import { parseExecutionHostId } from '../../../src/shared/execution-host'
import {
  assertFileMutationOwnershipCapability,
  buildFileMutationOwnership,
  FILE_MUTATION_OWNER_UNVERIFIED_MESSAGE,
  FILE_MUTATION_SSH_UNVERIFIED_MESSAGE,
  type FileMutationOwnership
} from '../../../src/shared/file-mutation-ownership'
import type { RuntimeStatus } from '../../../src/shared/runtime-types'
import type { SshConnectionState } from '../../../src/shared/ssh-types'
import type { RpcClient } from '../transport/rpc-client'
import {
  isLogicalClientCutoverError,
  LogicalClientCutoverError,
  type StableLogicalRpcClient
} from '../transport/stable-logical-rpc-client'
import type { RpcFailure, RpcSuccess } from '../transport/types'

const FILE_MUTATION_PREFLIGHT_TIMEOUT_MS = 15_000
const RUNTIME_OWNER_UNVERIFIED_MESSAGE =
  "Couldn't verify this workspace's runtime. Refresh the workspace list and try again."
const RUNTIME_CHANGED_MESSAGE = 'The Orca server changed while verifying the workspace. Try again.'
const PREFLIGHT_TIMEOUT_MESSAGE =
  "Couldn't verify the workspace before the request timed out. Check the connection and try again."
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

export type MobileFileMutationFence = {
  ownership: MobileFileMutationOwnership
  runtimeId: string
  transportGeneration: number | null
}

export function buildMobileFileMutationOwnership(
  worktreeHostId: string | null | undefined,
  sshState: SshConnectionState | null = null
): MobileFileMutationOwnership {
  const host = parseExecutionHostId(worktreeHostId)
  // Mobile cannot prove that its paired HUB owns an environment-scoped runtime.
  if (host?.kind === 'runtime') {
    throw new Error(RUNTIME_OWNER_UNVERIFIED_MESSAGE)
  }
  if (host?.kind === 'ssh' && sshState?.status !== 'connected') {
    throw new Error(FILE_MUTATION_SSH_UNVERIFIED_MESSAGE)
  }
  return buildFileMutationOwnership(worktreeHostId, sshState)
}

export async function captureMobileFileMutationOwnership(
  client: Pick<RpcClient, 'sendRequest'>,
  worktree: string
): Promise<MobileFileMutationFence> {
  const deadline = Date.now() + FILE_MUTATION_PREFLIGHT_TIMEOUT_MS
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await captureMobileFileMutationOwnershipOnce(client, worktree, deadline)
    } catch (error) {
      if (attempt === 0 && isLogicalClientCutoverError(error)) {
        continue
      }
      throw normalizePreflightError(error)
    }
  }
  throw new Error(RUNTIME_CHANGED_MESSAGE)
}

export function assertMobileFileMutationFenceCurrent(
  client: Pick<RpcClient, 'sendRequest'>,
  fence: MobileFileMutationFence
): void {
  const currentGeneration = getTransportGeneration(client)
  if (
    fence.transportGeneration !== null &&
    currentGeneration !== null &&
    currentGeneration !== fence.transportGeneration
  ) {
    throw new Error(RUNTIME_CHANGED_MESSAGE)
  }
}

export function assertMobileFileMutationResponseRuntime(
  fence: MobileFileMutationFence,
  response: RpcSuccess | RpcFailure
): void {
  if (response._meta.runtimeId !== fence.runtimeId) {
    throw new Error(RUNTIME_CHANGED_MESSAGE)
  }
}

async function captureMobileFileMutationOwnershipOnce(
  client: Pick<RpcClient, 'sendRequest'>,
  worktree: string,
  deadline: number
): Promise<MobileFileMutationFence> {
  const transportGeneration = getTransportGeneration(client)
  const statusPromise = requestResult<Pick<RuntimeStatus, 'capabilities'>>(
    client,
    'status.get',
    undefined,
    deadline
  ).then((response) => {
    assertFileMutationOwnershipCapability(response.result)
    return response
  })
  const worktreePromise = requestResult<{ worktree?: { hostId?: string | null } }>(
    client,
    'worktree.show',
    { worktree },
    deadline
  )
  const [status, worktreeResult] = await Promise.all([statusPromise, worktreePromise])
  assertCaptureTransportCurrent(client, transportGeneration)
  assertSameRuntime(status.runtimeId, worktreeResult.runtimeId)
  if (!worktreeResult.result.worktree) {
    throw new Error(FILE_MUTATION_OWNER_UNVERIFIED_MESSAGE)
  }

  const worktreeHostId = worktreeResult.result.worktree.hostId
  const host = parseExecutionHostId(worktreeHostId)
  let sshState: SshConnectionState | null = null
  if (host?.kind === 'ssh') {
    const ssh = await requestResult<{ state: SshConnectionState | null }>(
      client,
      'ssh.getState',
      { targetId: host.targetId },
      deadline
    )
    assertCaptureTransportCurrent(client, transportGeneration)
    assertSameRuntime(status.runtimeId, ssh.runtimeId)
    sshState = ssh.result.state
  }

  assertCaptureTransportCurrent(client, transportGeneration)
  assertPreflightTimeRemaining(deadline)
  return {
    ownership: buildMobileFileMutationOwnership(worktreeHostId, sshState),
    runtimeId: status.runtimeId,
    transportGeneration
  }
}

async function requestResult<TResult>(
  client: Pick<RpcClient, 'sendRequest'>,
  method: string,
  params: unknown,
  deadline: number
): Promise<{ result: TResult; runtimeId: string }> {
  const timeoutMs = assertPreflightTimeRemaining(deadline)
  const response = await client.sendRequest(method, params, {
    timeoutMs
  })
  if (!response.ok) {
    throw new Error(getMobileFileMutationFailureMessage(response))
  }
  const runtimeId = response._meta.runtimeId.trim()
  if (!runtimeId) {
    throw new Error(RUNTIME_CHANGED_MESSAGE)
  }
  return { result: response.result as TResult, runtimeId }
}

function getTransportGeneration(client: Pick<RpcClient, 'sendRequest'>): number | null {
  const logical = client as Partial<StableLogicalRpcClient>
  return typeof logical.getGeneration === 'function' ? logical.getGeneration() : null
}

function assertCaptureTransportCurrent(
  client: Pick<RpcClient, 'sendRequest'>,
  expectedGeneration: number | null
): void {
  const currentGeneration = getTransportGeneration(client)
  if (
    expectedGeneration !== null &&
    currentGeneration !== null &&
    currentGeneration !== expectedGeneration
  ) {
    throw new LogicalClientCutoverError()
  }
}

function assertSameRuntime(expectedRuntimeId: string, actualRuntimeId: string): void {
  if (actualRuntimeId !== expectedRuntimeId) {
    throw new Error(RUNTIME_CHANGED_MESSAGE)
  }
}

function assertPreflightTimeRemaining(deadline: number): number {
  const remaining = deadline - Date.now()
  if (remaining <= 0) {
    throw new Error(PREFLIGHT_TIMEOUT_MESSAGE)
  }
  return remaining
}

function normalizePreflightError(error: unknown): Error {
  if (
    error instanceof Error &&
    (error.message.includes('Request timed out:') ||
      error.message.includes('Timed out while connecting'))
  ) {
    return new Error(PREFLIGHT_TIMEOUT_MESSAGE)
  }
  if (isLogicalClientCutoverError(error)) {
    return new Error(RUNTIME_CHANGED_MESSAGE)
  }
  return error instanceof Error ? error : new Error(String(error))
}
