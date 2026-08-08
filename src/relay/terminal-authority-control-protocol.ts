import { MAX_SSH_RELAY_GRACE_PERIOD_SECONDS } from '../shared/ssh-types'
import { isRuntimePathAbsolute } from '../shared/cross-platform-path'
import type { RequestContext } from './dispatcher'

export const TERMINAL_AUTHORITY_CONFIGURE_GRACE_TIME_METHOD = 'terminalAuthority.configureGraceTime'
export const TERMINAL_AUTHORITY_ACQUIRE_WORKTREE_REMOVAL_METHOD =
  'terminalAuthority.acquireWorktreeRemoval'
export const TERMINAL_AUTHORITY_RELEASE_WORKTREE_REMOVAL_METHOD =
  'terminalAuthority.releaseWorktreeRemoval'

const REMOVAL_LEASE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const MAX_REMOTE_PATH_LENGTH = 4_096

export type TerminalAuthorityWorktreeRemovalParams = Readonly<{
  leaseToken: string
  rootPath: string
}>

export function parseRelayGraceTimeSeconds(params: Record<string, unknown>): number {
  const value = params.graceTimeSeconds
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < 0 ||
    Number(value) > MAX_SSH_RELAY_GRACE_PERIOD_SECONDS
  ) {
    throw new Error('relay_grace_time_invalid')
  }
  return Number(value)
}

export function parseTerminalAuthorityWorktreeRemovalParams(
  params: Record<string, unknown>
): TerminalAuthorityWorktreeRemovalParams {
  const leaseToken = params.leaseToken
  const rootPath = params.rootPath
  if (
    typeof leaseToken !== 'string' ||
    !REMOVAL_LEASE_TOKEN_PATTERN.test(leaseToken) ||
    typeof rootPath !== 'string' ||
    rootPath.length === 0 ||
    rootPath.length > MAX_REMOTE_PATH_LENGTH ||
    rootPath.includes('\0') ||
    !isRuntimePathAbsolute(rootPath)
  ) {
    throw new Error('terminal_authority_worktree_removal_invalid')
  }
  return Object.freeze({ leaseToken, rootPath })
}

export function assertAuthenticatedTerminalAuthorityControl(context: RequestContext): void {
  const identity = context.sessionIdentity
  if (
    !identity?.authenticated ||
    !identity.allowSessionOwner ||
    identity.authenticationKind !== 'endpoint-credential' ||
    !identity.principal.startsWith('terminal-authority:')
  ) {
    throw new Error('terminal_authority_control_not_authenticated')
  }
}

export function assertGraceTimeApplied(result: unknown, graceTimeSeconds: number): void {
  if (
    typeof result !== 'object' ||
    result === null ||
    (result as { graceTimeMs?: unknown }).graceTimeMs !== graceTimeSeconds * 1_000
  ) {
    throw new Error('terminal_authority_grace_time_not_applied')
  }
}

export function assertWorktreeRemovalLeaseResult(result: unknown, leaseToken: string): void {
  if (
    typeof result !== 'object' ||
    result === null ||
    (result as { leaseToken?: unknown }).leaseToken !== leaseToken
  ) {
    throw new Error('terminal_authority_worktree_removal_not_acknowledged')
  }
}
