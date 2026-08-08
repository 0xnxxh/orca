import { createHash } from 'node:crypto'
import type { TerminalLegacyWorkspaceEvidence } from '../../shared/terminal-legacy-cutover'
import type { TerminalAuthorityNamespace } from '../../shared/terminal-session-authority-identity'
import { terminalAuthorityNamespaceLocatorKey } from '../../shared/terminal-session-authority-locator'
import { parseAppSshPtyId } from '../../shared/ssh-pty-id'

type CanonicalValue =
  | boolean
  | number
  | string
  | null
  | readonly CanonicalValue[]
  | Readonly<{ [key: string]: CanonicalValue }>

export function sshLegacyEvidenceDigest(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value), 'utf8').digest('base64url')}`
}

export function sshLegacyEvidenceId(prefix: string, value: unknown): string {
  const digest = createHash('sha256').update(canonicalJson(value), 'utf8').digest('base64url')
  return `${prefix}-${digest}`
}

export function canonicalEvidenceSort<T>(values: readonly T[]): T[] {
  return [...values].sort(compareSshLegacyEvidence)
}

export function canonicalEvidenceEqual(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right)
}

export function compareSshLegacyEvidence(left: unknown, right: unknown): number {
  return compareSshLegacyText(canonicalJson(left), canonicalJson(right))
}

export function compareSshLegacyText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

export function sshLegacyWorkspaceKey(workspace: TerminalLegacyWorkspaceEvidence): string {
  return canonicalJson([
    workspace.kind,
    terminalAuthorityNamespaceLocatorKey(workspace.locator),
    workspace.kind === 'git-worktree' ? workspace.worktreeId : null
  ])
}

export function sshLegacyWorkspaceAndNamespaceEqual(
  left: Readonly<{
    namespace: TerminalAuthorityNamespace
    workspace: TerminalLegacyWorkspaceEvidence
  }>,
  right: Readonly<{
    namespace: TerminalAuthorityNamespace
    workspace: TerminalLegacyWorkspaceEvidence
  }>
): boolean {
  return (
    left.namespace.authorityHostId === right.namespace.authorityHostId &&
    left.namespace.namespaceId === right.namespace.namespaceId &&
    sshLegacyWorkspaceKey(left.workspace) === sshLegacyWorkspaceKey(right.workspace)
  )
}

export function sshLegacyWorkspaceWorktreeId(
  workspace: TerminalLegacyWorkspaceEvidence
): string | null {
  return workspace.kind === 'git-worktree' ? workspace.worktreeId : null
}

export function sshLegacyPhysicalPtyId(targetId: string, ptyId: string): string | null {
  const parsed = parseAppSshPtyId(ptyId)
  if (!parsed) {
    return ptyId
  }
  return parsed.connectionId === targetId ? parsed.relayPtyId : null
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(toCanonicalValue(value))
}

function toCanonicalValue(value: unknown): CanonicalValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('SSH legacy migration evidence contains a non-finite number')
    }
    return value
  }
  if (Array.isArray(value)) {
    return value.map((entry) => toCanonicalValue(entry))
  }
  if (typeof value !== 'object') {
    throw new Error('SSH legacy migration evidence contains an unsupported value')
  }
  const canonical: Record<string, CanonicalValue> = {}
  for (const key of Object.keys(value).sort()) {
    const selected = (value as Record<string, unknown>)[key]
    if (selected !== undefined) {
      canonical[key] = toCanonicalValue(selected)
    }
  }
  return canonical
}
