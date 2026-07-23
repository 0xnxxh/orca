import {
  FILE_MUTATION_OWNERSHIP_RUNTIME_CAPABILITY,
  FILE_MUTATION_OWNERSHIP_UPDATE_REQUIRED_MESSAGE
} from './protocol-version'
import { parseExecutionHostId } from './execution-host'
import type { RuntimeStatus } from './runtime-types'
import type { SshConnectionState, SshMutationExpectation } from './ssh-types'

export const FILE_MUTATION_OWNER_UNVERIFIED_MESSAGE =
  "Couldn't verify where this workspace's files are stored. Refresh the workspace list and try again."
export const FILE_MUTATION_SSH_UNVERIFIED_MESSAGE =
  "Couldn't verify this workspace's SSH connection. Reconnect the host and try again."

export type FileMutationOwnership = SshMutationExpectation & {
  expectedExecutionHostId: 'local' | `ssh:${string}`
}

export function assertFileMutationOwnershipCapability(
  status: Pick<RuntimeStatus, 'capabilities'>
): void {
  if (!status.capabilities?.includes(FILE_MUTATION_OWNERSHIP_RUNTIME_CAPABILITY)) {
    throw new Error(FILE_MUTATION_OWNERSHIP_UPDATE_REQUIRED_MESSAGE)
  }
}

export function buildFileMutationOwnership(
  worktreeHostId: string | null | undefined,
  sshState: SshConnectionState | null = null
): FileMutationOwnership {
  const host = parseExecutionHostId(worktreeHostId)
  if (!host) {
    throw new Error(FILE_MUTATION_OWNER_UNVERIFIED_MESSAGE)
  }
  if (host.kind === 'local' || host.kind === 'runtime') {
    return { expectedExecutionHostId: 'local' }
  }
  if (sshState?.targetId !== host.targetId || sshState.connectionGeneration === undefined) {
    throw new Error(FILE_MUTATION_SSH_UNVERIFIED_MESSAGE)
  }
  return {
    expectedExecutionHostId: host.id,
    expectedSshTargetId: host.targetId,
    expectedSshConnectionGeneration: sshState.connectionGeneration
  }
}
