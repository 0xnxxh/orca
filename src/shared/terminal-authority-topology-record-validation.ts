import type {
  TerminalLegacyRecoveryNotice,
  TerminalLegacyRecoveryNoticeProjection,
  TerminalLegacyRecoveryReason
} from './terminal-legacy-cutover'
import {
  assertAuthorityId,
  assertPaneGeneration,
  assertTerminalBinding,
  isRecord,
  terminalPaneGenerationKey,
  terminalPtyIncarnationKey,
  type TerminalPaneGeneration,
  type TerminalSessionBinding
} from './terminal-session-authority-identity'
import type { TerminalPaneAuthorityProjection } from './terminal-session-authority-mutation'
import { TERMINAL_AUTHORITY_TOPOLOGY_MAX_RECOVERY_NOTICES } from './terminal-authority-topology-stream-contract'
import { failTerminalAuthorityTopologyStreamValidation as reject } from './terminal-authority-topology-stream-errors'

const PANE_STATUSES = new Set(['open', 'closed', 'superseded', 'exited'])
const OWNER_STATUSES = new Set(['reachable', 'owner-unreachable'])
const RECOVERY_REASONS = new Set<TerminalLegacyRecoveryReason>([
  'ambiguous-pane-generation',
  'endpoint-identity-unproved',
  'physical-pty-incarnation-unproved',
  'unsupported-platform',
  'worker-unreachable',
  'workspace-mismatch'
])
const PRESERVATION_KINDS = new Set([
  'isolated-grace-disabled',
  'evidence-gc-retained',
  'worker-unreachable',
  'unsupported-platform'
])
const WORKSPACE_KINDS = new Set(['git-worktree', 'folder', 'floating'])

function safeInteger(value: unknown, field: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) {
    reject(`${field} is invalid`)
  }
  return Number(value)
}

export function parseTerminalAuthorityTopologyPaneGeneration(
  value: unknown
): TerminalPaneGeneration {
  assertPaneGeneration(value)
  return Object.freeze({ paneKey: value.paneKey, paneGenerationId: value.paneGenerationId })
}

function binding(value: unknown): TerminalSessionBinding {
  assertTerminalBinding(value)
  return Object.freeze({
    ownerIncarnationId: value.ownerIncarnationId,
    physicalPtyId: value.physicalPtyId,
    ptyIncarnationId: value.ptyIncarnationId
  })
}

function optionalBinding(value: unknown): TerminalSessionBinding | null {
  return value === null ? null : binding(value)
}

export function parseTerminalAuthorityTopologyPane(
  value: unknown
): TerminalPaneAuthorityProjection {
  if (!isRecord(value)) {
    reject('topology pane is invalid')
  }
  assertAuthorityId(value.paneKey, 'paneKey')
  assertAuthorityId(value.paneGenerationId, 'paneGenerationId')
  if (!PANE_STATUSES.has(String(value.status))) {
    reject('topology pane status is invalid')
  }
  const liveBinding = optionalBinding(value.binding)
  const lastBinding = optionalBinding(value.lastBinding)
  const revision = safeInteger(value.revision, 'topology pane revision', 1)
  if (value.status !== 'open' && liveBinding !== null) {
    reject('inactive topology pane retains a binding')
  }
  if (
    (liveBinding === null && value.ownerStatus !== null) ||
    (liveBinding !== null && !OWNER_STATUSES.has(String(value.ownerStatus)))
  ) {
    reject('topology pane owner status is invalid')
  }
  return Object.freeze({
    paneKey: value.paneKey,
    paneGenerationId: value.paneGenerationId,
    status: value.status as TerminalPaneAuthorityProjection['status'],
    binding: liveBinding,
    lastBinding,
    revision,
    ownerStatus: value.ownerStatus as TerminalPaneAuthorityProjection['ownerStatus']
  })
}

function recoveryNotice(value: unknown): TerminalLegacyRecoveryNotice {
  if (!isRecord(value)) {
    reject('legacy recovery notice is invalid')
  }
  assertAuthorityId(value.recoveryKey, 'recoveryKey')
  assertAuthorityId(value.evidenceDigest, 'evidenceDigest')
  if (!WORKSPACE_KINDS.has(String(value.workspaceKind))) {
    reject('legacy recovery workspace kind is invalid')
  }
  const discoveredAtMs = safeInteger(value.discoveredAtMs, 'recovery discoveredAtMs')
  const base = {
    recoveryKey: value.recoveryKey,
    workspaceKind: value.workspaceKind as TerminalLegacyRecoveryNotice['workspaceKind'],
    evidenceDigest: value.evidenceDigest,
    observedAtMs: safeInteger(value.observedAtMs, 'recovery observedAtMs'),
    discoveredAtMs,
    updatedAtMs: safeInteger(value.updatedAtMs, 'recovery updatedAtMs', discoveredAtMs)
  }
  if (value.status === 'imported') {
    return Object.freeze({ ...base, status: 'imported' })
  }
  if (
    (value.status !== 'unresolved' && value.status !== 'acknowledged') ||
    !RECOVERY_REASONS.has(value.reason as TerminalLegacyRecoveryReason) ||
    !PRESERVATION_KINDS.has(String(value.preservationKind))
  ) {
    reject('legacy recovery notice state is invalid')
  }
  type NoticeWithPreservation = Extract<
    TerminalLegacyRecoveryNotice,
    { status: 'unresolved' | 'acknowledged' }
  >
  return Object.freeze({
    ...base,
    status: value.status,
    reason: value.reason as TerminalLegacyRecoveryReason,
    preservationKind: value.preservationKind as NoticeWithPreservation['preservationKind']
  })
}

export function parseTerminalAuthorityRecoveryNoticeProjection(
  value: unknown
): TerminalLegacyRecoveryNoticeProjection {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.notices)) {
    reject('legacy recovery notice projection is invalid')
  }
  if (value.notices.length > TERMINAL_AUTHORITY_TOPOLOGY_MAX_RECOVERY_NOTICES) {
    reject('legacy recovery notice capacity exceeded')
  }
  const notices = value.notices.map(recoveryNotice)
  const keys = new Set<string>()
  for (const notice of notices) {
    if (keys.has(notice.recoveryKey)) {
      reject('legacy recovery notice is duplicated')
    }
    keys.add(notice.recoveryKey)
  }
  return Object.freeze({
    version: 1,
    revision: safeInteger(value.revision, 'legacy recovery notice revision'),
    notices: Object.freeze(notices)
  })
}

export function assertTerminalAuthorityTopologyPanes(
  panes: readonly TerminalPaneAuthorityProjection[],
  authorityRevision: number
): void {
  const paneGenerations = new Set<string>()
  const openPaneKeys = new Set<string>()
  const liveBindings = new Set<string>()
  for (const record of panes) {
    const key = terminalPaneGenerationKey(record)
    if (record.revision > authorityRevision || paneGenerations.has(key)) {
      reject('topology pane collection is inconsistent')
    }
    if (record.status === 'open' && openPaneKeys.has(record.paneKey)) {
      reject('topology contains two open pane generations')
    }
    if (record.status === 'open') {
      openPaneKeys.add(record.paneKey)
    }
    if (record.binding) {
      const bindingKey = terminalPtyIncarnationKey(record.binding)
      if (liveBindings.has(bindingKey)) {
        reject('topology binds one PTY incarnation twice')
      }
      liveBindings.add(bindingKey)
    }
    paneGenerations.add(key)
  }
}
