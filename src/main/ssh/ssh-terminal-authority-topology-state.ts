import type { TerminalAuthorityTopologySnapshot } from '../../shared/terminal-authority-topology-stream-contract'
import type { SshTerminalAuthorityTopologyClientStatus } from './ssh-terminal-authority-topology-client'

type SynchronizationReason = Extract<
  SshTerminalAuthorityTopologyClientStatus,
  { kind: 'synchronizing' }
>['reason']

export type SshTerminalAuthorityNamespaceTopologyState =
  | Readonly<{ kind: 'disconnected' }>
  | Readonly<{ kind: 'legacy-fallback' }>
  | Readonly<{ kind: 'synchronizing'; reason: SynchronizationReason }>
  | Readonly<{
      kind: 'authority-unavailable'
      reason: 'disconnected' | 'capability-not-granted'
    }>
  | Readonly<{
      kind: 'authority-unavailable'
      reason: 'synchronizing'
      synchronizationReason: SynchronizationReason
    }>
  | Readonly<{ kind: 'authority-unavailable'; reason: 'stale'; error: Error }>
  // Once emitted, every non-authoritative successor is fail-closed.
  | Readonly<{ kind: 'authoritative'; snapshot: TerminalAuthorityTopologySnapshot }>
  | Readonly<{ kind: 'stale'; error: Error }>
  | Readonly<{ kind: 'disposed' }>

export type SshTerminalAuthorityNamespaceTopologySink = (
  state: SshTerminalAuthorityNamespaceTopologyState
) => void

export type SshTerminalAuthorityNamespaceTopologyAttachOptions = Readonly<{
  durableCutoverCommitted?: boolean
}>

export function initialSshTerminalAuthorityTopologyState(
  authorityCommitted: boolean,
  hasTransport: boolean,
  hasCapabilityGrant: boolean
): SshTerminalAuthorityNamespaceTopologyState {
  if (!authorityCommitted) {
    if (!hasTransport) {
      return Object.freeze({ kind: 'disconnected' })
    }
    return hasCapabilityGrant
      ? Object.freeze({ kind: 'synchronizing', reason: 'initial' })
      : Object.freeze({ kind: 'legacy-fallback' })
  }
  if (!hasTransport) {
    return Object.freeze({ kind: 'authority-unavailable', reason: 'disconnected' })
  }
  return hasCapabilityGrant
    ? Object.freeze({
        kind: 'authority-unavailable',
        reason: 'synchronizing',
        synchronizationReason: 'initial'
      })
    : Object.freeze({ kind: 'authority-unavailable', reason: 'capability-not-granted' })
}

export function sshTerminalAuthorityTopologyCapabilityState(
  authorityCommitted: boolean
): SshTerminalAuthorityNamespaceTopologyState {
  return authorityCommitted
    ? Object.freeze({ kind: 'authority-unavailable', reason: 'capability-not-granted' })
    : Object.freeze({ kind: 'legacy-fallback' })
}

export function sshTerminalAuthorityTopologyDisconnectedState(
  authorityCommitted: boolean
): SshTerminalAuthorityNamespaceTopologyState {
  return authorityCommitted
    ? Object.freeze({ kind: 'authority-unavailable', reason: 'disconnected' })
    : Object.freeze({ kind: 'disconnected' })
}

export function sshTerminalAuthorityTopologySynchronizingState(
  authorityCommitted: boolean,
  reason: SynchronizationReason
): SshTerminalAuthorityNamespaceTopologyState {
  return authorityCommitted
    ? Object.freeze({
        kind: 'authority-unavailable',
        reason: 'synchronizing',
        synchronizationReason: reason
      })
    : Object.freeze({ kind: 'synchronizing', reason })
}

export function sshTerminalAuthorityTopologyStaleState(
  authorityCommitted: boolean,
  error: Error
): SshTerminalAuthorityNamespaceTopologyState {
  return authorityCommitted
    ? Object.freeze({ kind: 'authority-unavailable', reason: 'stale', error })
    : Object.freeze({ kind: 'stale', error })
}

export function commitSshTerminalAuthorityTopologyState(
  state: SshTerminalAuthorityNamespaceTopologyState
): SshTerminalAuthorityNamespaceTopologyState {
  if (state.kind === 'disconnected') {
    return Object.freeze({ kind: 'authority-unavailable', reason: 'disconnected' })
  }
  if (state.kind === 'legacy-fallback') {
    return Object.freeze({ kind: 'authority-unavailable', reason: 'capability-not-granted' })
  }
  if (state.kind === 'synchronizing') {
    return Object.freeze({
      kind: 'authority-unavailable',
      reason: 'synchronizing',
      synchronizationReason: state.reason
    })
  }
  if (state.kind === 'stale') {
    return Object.freeze({ kind: 'authority-unavailable', reason: 'stale', error: state.error })
  }
  return state
}
