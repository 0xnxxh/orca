import { posix, win32 } from 'node:path'
import type { TerminalLegacyWorkspaceEvidence } from '../../shared/terminal-legacy-cutover'
import {
  assertTerminalAuthorityNamespaceLocator,
  terminalAuthorityNamespaceLocatorKey,
  type TerminalAuthorityNamespaceLocator,
  type TerminalAuthorityPathFlavor
} from '../../shared/terminal-session-authority-locator'
import { failSshLegacyMigrationEvidence } from './ssh-legacy-migration-evidence-capacity'
import type {
  SshLegacyWorkspaceReference,
  SshLegacyWorkspaceResolution,
  SshLegacyWorkspaceResolutionRequest,
  SshLegacyWorkspaceResolver
} from './ssh-legacy-migration-evidence-bridge-types'
import { sshLegacyEvidenceId } from './ssh-legacy-migration-evidence-identity'

type IndexedReference = Extract<
  SshLegacyWorkspaceReference,
  { kind: 'git-worktree' | 'folder-workspace' }
>

/**
 * Resolves a legacy workspace reference to the final host's own locator. The namespace is derived
 * from the host-local canonical path, never from the client's repository or SSH target id.
 */
export function createSshLegacyHostLocatorResolver(
  input: Readonly<{
    authorityHostId: string
    hostPathFlavor: TerminalAuthorityPathFlavor
    references: readonly SshLegacyWorkspaceReference[]
  }>
): SshLegacyWorkspaceResolver {
  const byCanonicalPath = indexReferences(input.hostPathFlavor, input.references)
  return (request: SshLegacyWorkspaceResolutionRequest): SshLegacyWorkspaceResolution => {
    if (request.authorityHostId !== input.authorityHostId) {
      failSshLegacyMigrationEvidence('resolution', 'workspace resolution authority host')
    }
    const reference =
      request.reference.kind === 'workspace-path'
        ? (byCanonicalPath.get(canonicalHostPath(input.hostPathFlavor, request.reference.path)) ??
          request.reference)
        : request.reference
    return resolution(input.authorityHostId, input.hostPathFlavor, reference)
  }
}

function indexReferences(
  flavor: TerminalAuthorityPathFlavor,
  references: readonly SshLegacyWorkspaceReference[]
): ReadonlyMap<string, IndexedReference> {
  const index = new Map<string, IndexedReference>()
  for (const reference of references) {
    if (reference.kind !== 'git-worktree' && reference.kind !== 'folder-workspace') {
      continue
    }
    const key = canonicalHostPath(flavor, reference.path)
    const existing = index.get(key)
    if (existing && !sameIndexedReference(existing, reference)) {
      // Two client workspaces claim one host path: the host cannot name a single namespace owner.
      failSshLegacyMigrationEvidence('ambiguity', 'host workspace locator')
    }
    index.set(key, reference)
  }
  return index
}

function sameIndexedReference(left: IndexedReference, right: IndexedReference): boolean {
  return left.kind === right.kind && left.clientWorkspaceId === right.clientWorkspaceId
}

function resolution(
  authorityHostId: string,
  flavor: TerminalAuthorityPathFlavor,
  reference: SshLegacyWorkspaceReference
): SshLegacyWorkspaceResolution {
  const locator = referenceLocator(flavor, reference)
  assertTerminalAuthorityNamespaceLocator(locator)
  return Object.freeze({
    namespace: Object.freeze({
      authorityHostId,
      namespaceId: sshLegacyEvidenceId('ssh-legacy-namespace', [
        authorityHostId,
        terminalAuthorityNamespaceLocatorKey(locator)
      ])
    }),
    workspace: workspaceEvidence(reference, locator)
  })
}

function referenceLocator(
  flavor: TerminalAuthorityPathFlavor,
  reference: SshLegacyWorkspaceReference
): TerminalAuthorityNamespaceLocator {
  if (reference.kind === 'floating') {
    return Object.freeze({ kind: 'floating' })
  }
  return Object.freeze({
    kind: 'workspace',
    canonicalPath: canonicalHostPath(flavor, reference.path),
    pathFlavor: flavor
  })
}

function workspaceEvidence(
  reference: SshLegacyWorkspaceReference,
  locator: TerminalAuthorityNamespaceLocator
): TerminalLegacyWorkspaceEvidence {
  if (locator.kind === 'floating') {
    return Object.freeze({ kind: 'floating', locator })
  }
  // Why the client id and not the host path: worktreeId stays legacy match evidence that must still
  // equal the recorded lease, while the namespace above is host-derived.
  return reference.kind === 'git-worktree'
    ? Object.freeze({ kind: 'git-worktree', locator, worktreeId: reference.clientWorkspaceId })
    : Object.freeze({ kind: 'folder', locator })
}

export function canonicalHostPath(flavor: TerminalAuthorityPathFlavor, value: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    failSshLegacyMigrationEvidence('malformed', 'host workspace path')
  }
  const canonical = flavor === 'windows' ? canonicalWindowsPath(value) : canonicalPosixPath(value)
  if (canonical === null) {
    failSshLegacyMigrationEvidence('malformed', 'host workspace path')
  }
  return canonical
}

function canonicalPosixPath(value: string): string | null {
  if (!value.startsWith('/')) {
    return null
  }
  const normalized = posix.normalize(value)
  return normalized.length > 1 ? normalized.replace(/\/+$/u, '') : '/'
}

function canonicalWindowsPath(value: string): string | null {
  const normalized = win32.normalize(value).replace(/\\/gu, '/')
  if (/^[A-Za-z]:\//u.test(normalized)) {
    return `${normalized[0].toUpperCase()}:/${normalized.slice(3).replace(/\/+$/u, '')}`
  }
  return /^\/\/[^/]+\/[^/]+/u.test(normalized) ? normalized.replace(/(.)\/+$/u, '$1') : null
}
