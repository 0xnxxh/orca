import type { ExecutionHostId } from '../execution-host'
import type { Worktree } from './types'

/**
 * Separator between the host and the workspace id.
 *
 * Printable on purpose: these identities become React keys and DOM attribute
 * values, and HTML attribute parsing replaces U+0000 with U+FFFD — a NUL
 * separator would not survive the round trip an anchor comparison depends on.
 * The host comes first so the variable-length id absorbs any `|` of its own.
 */
const HOST_SEPARATOR = '|'

/**
 * Stable key for one workspace on one host (STA-4343).
 *
 * `worktreeId` is `repoId::path` with no host component, so a repo registered on
 * two execution hosts publishes the same id twice for two different workspaces.
 * Any map, set or React key that must keep them apart keys on this instead.
 *
 * An unqualified row gets its own bucket rather than being folded into a host:
 * it may well BE one of them, but nothing here can prove which.
 */
export function getWorktreeHostIdentity(worktree: Pick<Worktree, 'id' | 'hostId'>): string {
  return composeWorktreeHostIdentity(worktree.hostId, worktree.id)
}

export function composeWorktreeHostIdentity(
  hostId: ExecutionHostId | undefined,
  worktreeId: string
): string {
  return `${hostId ?? ''}${HOST_SEPARATOR}${worktreeId}`
}

/**
 * The workspace id back out of an identity.
 *
 * Host-first ordering makes this exact: the host cannot contain the separator,
 * so everything after the first one is the id — which lets an index recover the
 * id without re-reading it off the row.
 */
export function getWorktreeIdFromHostIdentity(identity: string): string {
  return identity.slice(identity.indexOf(HOST_SEPARATOR) + 1)
}
