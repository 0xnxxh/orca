import { createHash } from 'node:crypto'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../shared/constants'
import { isAgentSessionSurfaceBinding } from '../../shared/agent-session-host-authority'
import { makePaneKey } from '../../shared/stable-pane-id'
import type {
  TerminalPaneGeneration,
  TerminalSessionBinding
} from '../../shared/terminal-session-authority-identity'
import {
  failTerminalSessionAuthority,
  type TerminalAuthorityProjection,
  type TerminalPaneAuthorityProjection
} from '../../shared/terminal-session-authority-mutation'
import {
  TERMINAL_SESSION_AUTHORITY_SPAWN_VERSION,
  isTerminalSessionAuthorityPaneGeneration
} from '../../shared/terminal-session-authority-wire'
import { splitWorktreeIdForFilesystem } from '../../shared/worktree-id'
import {
  terminalAuthorityFloatingLocator,
  terminalAuthorityWorkspaceLocator
} from './terminal-session-authority-workspace-locator'

export function parseTerminalAuthoritySpawnIdentity(
  params: Record<string, unknown>,
  ownerIncarnationId: string
) {
  if (params.terminalSessionAuthorityVersion !== TERMINAL_SESSION_AUTHORITY_SPAWN_VERSION) {
    throw new Error('terminal_session_authority_metadata_required')
  }
  const ensure =
    typeof params.agentSessionEnsure === 'object' && params.agentSessionEnsure !== null
      ? (params.agentSessionEnsure as { surface?: unknown })
      : null
  const surface = isAgentSessionSurfaceBinding(ensure?.surface) ? ensure.surface : null
  const paneKey =
    typeof params.paneKey === 'string'
      ? params.paneKey
      : surface
        ? makePaneKey(surface.tabId, surface.leafId)
        : null
  if (!paneKey) {
    throw new Error('terminal_session_authority_pane_required')
  }
  const paneGenerationId = isTerminalSessionAuthorityPaneGeneration(params.paneGeneration)
    ? `renderer:${params.paneGeneration}`
    : surface
      ? `agent:${surface.terminalHandle}:${ownerIncarnationId}`
      : null
  if (!paneGenerationId) {
    throw new Error('terminal_session_authority_generation_required')
  }
  const worktreeId = typeof params.worktreeId === 'string' ? params.worktreeId : surface?.worktreeId
  const locator = terminalAuthorityLocatorForWorktreeId(worktreeId)
  return Object.freeze({
    pane: Object.freeze({ paneKey, paneGenerationId }),
    locator,
    locatorKey: JSON.stringify(locator),
    spawnFingerprint: createHash('sha256')
      .update(JSON.stringify(canonicalJson(spawnFingerprintParams(params))))
      .digest('base64url')
  })
}

export function findTerminalAuthorityPane(
  projection: TerminalAuthorityProjection,
  pane: TerminalPaneGeneration
): TerminalPaneAuthorityProjection | null {
  return (
    projection.panes.find(
      (candidate) =>
        candidate.paneKey === pane.paneKey && candidate.paneGenerationId === pane.paneGenerationId
    ) ?? null
  )
}

export function latestTerminalAuthorityPane(
  projection: TerminalAuthorityProjection,
  paneKey: string
): TerminalPaneAuthorityProjection | null {
  return (
    projection.panes
      .filter((pane) => pane.paneKey === paneKey)
      .sort((left, right) => right.revision - left.revision)[0] ?? null
  )
}

export function exactTerminalAuthorityAllocation(
  projection: TerminalAuthorityProjection,
  binding: TerminalSessionBinding
) {
  const allocation = projection.allocations.find(
    (candidate) =>
      candidate.status === 'committed' && sameTerminalAuthorityBinding(candidate.binding, binding)
  )
  if (!allocation || allocation.status !== 'committed') {
    failTerminalSessionAuthority('record-corrupt', 'pane binding has no committed allocation')
  }
  return allocation
}

export function sameTerminalAuthorityBinding(
  left: TerminalSessionBinding | null,
  right: TerminalSessionBinding
): boolean {
  return Boolean(
    left &&
    left.ownerIncarnationId === right.ownerIncarnationId &&
    left.physicalPtyId === right.physicalPtyId &&
    left.ptyIncarnationId === right.ptyIncarnationId
  )
}

function spawnFingerprintParams(params: Record<string, unknown>): Record<string, unknown> {
  const fingerprint = { ...params }
  for (const field of [
    'agentSessionCreateOperationId',
    'cols',
    'rows',
    'paneKey',
    'paneGeneration',
    'tabId',
    'terminalSessionAuthorityVersion',
    'worktreeId'
  ]) {
    delete fingerprint[field]
  }
  return fingerprint
}

export function terminalAuthorityLocatorForWorktreeId(worktreeId: string | undefined) {
  if (worktreeId === FLOATING_TERMINAL_WORKTREE_ID) {
    return terminalAuthorityFloatingLocator()
  }
  const workspacePath = worktreeId ? splitWorktreeIdForFilesystem(worktreeId)?.worktreePath : null
  if (!workspacePath) {
    throw new Error('terminal_session_authority_workspace_required')
  }
  return terminalAuthorityWorkspaceLocator(workspacePath)
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalJson)
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalJson(entry)])
    )
  }
  return value
}
