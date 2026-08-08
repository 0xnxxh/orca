import {
  sameTerminalBinding,
  terminalPaneGenerationKey
} from '../../shared/terminal-session-authority-identity'
import type {
  TerminalAuthorityTopologyChange,
  TerminalAuthorityTopologySnapshot
} from '../../shared/terminal-authority-topology-stream-contract'
import { TerminalAuthorityTopologyStreamValidationError } from '../../shared/terminal-authority-topology-stream-errors'
import { assertTerminalAuthorityTopologyPanes } from '../../shared/terminal-authority-topology-record-validation'
import { sameTerminalAuthorityTopologyNamespace } from '../../shared/terminal-authority-topology-stream-validation'

export type SshTerminalAuthorityTopologyResnapshotReason =
  | 'not-initialized'
  | 'subscription-changed'
  | 'namespace-changed'
  | 'stream-incarnation-changed'
  | 'writer-epoch-changed'
  | 'sequence-gap'
  | 'stale-sequence'
  | 'sequence-conflict'
  | 'revision-conflict'
  | 'topology-conflict'
  | 'recovery-revision-conflict'
  | 'snapshot-regressed'
  | 'snapshot-conflict'
  | 'notification-invalid'
  | 'buffer-capacity'

export type SshTerminalAuthorityTopologyApplyResult =
  | Readonly<{ kind: 'applied'; state: TerminalAuthorityTopologySnapshot }>
  | Readonly<{ kind: 'duplicate'; reason: 'covered-by-snapshot' | 'exact-replay' }>
  | Readonly<{
      kind: 'resnapshot-required'
      reason: SshTerminalAuthorityTopologyResnapshotReason
    }>

const MAX_RETAINED_CHANGE_SIGNATURES = 256

function resnapshot(
  reason: SshTerminalAuthorityTopologyResnapshotReason
): SshTerminalAuthorityTopologyApplyResult {
  return Object.freeze({ kind: 'resnapshot-required', reason })
}

function comparePaneKeys(
  left: TerminalAuthorityTopologySnapshot['panes'][number],
  right: TerminalAuthorityTopologySnapshot['panes'][number]
): number {
  return terminalPaneGenerationKey(left).localeCompare(terminalPaneGenerationKey(right))
}

function recoveryProjectionsEqual(
  left: TerminalAuthorityTopologySnapshot['namespaceRecoveryNotices'],
  right: TerminalAuthorityTopologySnapshot['namespaceRecoveryNotices']
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function paneCoreEqual(
  left: TerminalAuthorityTopologySnapshot['panes'][number],
  right: TerminalAuthorityTopologySnapshot['panes'][number]
): boolean {
  return (
    left.paneKey === right.paneKey &&
    left.paneGenerationId === right.paneGenerationId &&
    left.status === right.status &&
    sameTerminalBinding(left.binding, right.binding) &&
    sameTerminalBinding(left.lastBinding, right.lastBinding)
  )
}

function snapshotStateSignature(snapshot: TerminalAuthorityTopologySnapshot): string {
  return JSON.stringify({
    authorityRevision: snapshot.authorityRevision,
    panes: [...snapshot.panes].sort(comparePaneKeys),
    namespaceRecoveryNotices: snapshot.namespaceRecoveryNotices
  })
}

export class SshTerminalAuthorityTopologyReducer {
  private current: TerminalAuthorityTopologySnapshot | null = null
  private snapshotSequence = 0
  private paneRecords = new Map<string, TerminalAuthorityTopologySnapshot['panes'][number]>()
  private readonly changeSignatures = new Map<number, string>()

  replace(snapshot: TerminalAuthorityTopologySnapshot): TerminalAuthorityTopologySnapshot {
    this.paneRecords = new Map(
      snapshot.panes.map((record) => [terminalPaneGenerationKey(record), record])
    )
    this.current = snapshot
    this.snapshotSequence = snapshot.appliedChangeSequence
    this.changeSignatures.clear()
    return snapshot
  }

  state(): TerminalAuthorityTopologySnapshot | null {
    return this.current
  }

  snapshotConflict(
    snapshot: TerminalAuthorityTopologySnapshot
  ): 'snapshot-regressed' | 'snapshot-conflict' | null {
    const current = this.current
    if (!current) {
      return null
    }
    if (
      snapshot.writerEpoch < current.writerEpoch ||
      snapshot.authorityRevision < current.authorityRevision ||
      snapshot.namespaceRecoveryNotices.revision < current.namespaceRecoveryNotices.revision ||
      (snapshot.streamIncarnationId === current.streamIncarnationId &&
        (snapshot.writerEpoch !== current.writerEpoch ||
          snapshot.appliedChangeSequence < current.appliedChangeSequence))
    ) {
      return 'snapshot-regressed'
    }
    if (
      snapshot.streamIncarnationId === current.streamIncarnationId &&
      snapshot.writerEpoch === current.writerEpoch &&
      snapshot.appliedChangeSequence === current.appliedChangeSequence &&
      snapshotStateSignature(snapshot) !== snapshotStateSignature(current)
    ) {
      return 'snapshot-conflict'
    }
    return null
  }

  apply(change: TerminalAuthorityTopologyChange): SshTerminalAuthorityTopologyApplyResult {
    const current = this.current
    if (!current) {
      return resnapshot('not-initialized')
    }
    const headerConflict = this.headerConflict(current, change)
    if (headerConflict) {
      return resnapshot(headerConflict)
    }
    if (change.changeSequence <= current.appliedChangeSequence) {
      return this.replayResult(change)
    }
    if (change.changeSequence !== current.appliedChangeSequence + 1) {
      return resnapshot('sequence-gap')
    }
    if (change.baseAuthorityRevision !== current.authorityRevision) {
      return resnapshot('revision-conflict')
    }
    const nextPanes = new Map(this.paneRecords)
    for (const operation of change.paneChanges) {
      const key = terminalPaneGenerationKey(operation.pane)
      if (operation.kind === 'remove') {
        if (!nextPanes.delete(key)) {
          return resnapshot('topology-conflict')
        }
      } else {
        const currentPane = nextPanes.get(key)
        if (
          currentPane &&
          (operation.pane.revision < currentPane.revision ||
            (operation.pane.revision === currentPane.revision &&
              !paneCoreEqual(currentPane, operation.pane)))
        ) {
          return resnapshot('topology-conflict')
        }
        nextPanes.set(key, operation.pane)
      }
    }
    const recoveryNotices = change.namespaceRecoveryNotices ?? current.namespaceRecoveryNotices
    if (
      recoveryNotices.revision < current.namespaceRecoveryNotices.revision ||
      (recoveryNotices.revision === current.namespaceRecoveryNotices.revision &&
        !recoveryProjectionsEqual(recoveryNotices, current.namespaceRecoveryNotices))
    ) {
      return resnapshot('recovery-revision-conflict')
    }
    const panes = [...nextPanes.values()].sort(comparePaneKeys)
    try {
      assertTerminalAuthorityTopologyPanes(panes, change.authorityRevision)
    } catch (error) {
      if (error instanceof TerminalAuthorityTopologyStreamValidationError) {
        return resnapshot('topology-conflict')
      }
      throw error
    }
    const next = Object.freeze({
      protocolVersion: 1 as const,
      subscriptionId: current.subscriptionId,
      streamIncarnationId: current.streamIncarnationId,
      namespace: current.namespace,
      writerEpoch: current.writerEpoch,
      authorityRevision: change.authorityRevision,
      appliedChangeSequence: change.changeSequence,
      panes: Object.freeze(panes),
      namespaceRecoveryNotices: recoveryNotices
    })
    this.paneRecords = nextPanes
    this.current = next
    this.rememberChange(change)
    return Object.freeze({ kind: 'applied', state: next })
  }

  private headerConflict(
    current: TerminalAuthorityTopologySnapshot,
    change: TerminalAuthorityTopologyChange
  ): SshTerminalAuthorityTopologyResnapshotReason | null {
    if (change.subscriptionId !== current.subscriptionId) {
      return 'subscription-changed'
    }
    if (!sameTerminalAuthorityTopologyNamespace(change.namespace, current.namespace)) {
      return 'namespace-changed'
    }
    if (change.streamIncarnationId !== current.streamIncarnationId) {
      return 'stream-incarnation-changed'
    }
    return change.writerEpoch === current.writerEpoch ? null : 'writer-epoch-changed'
  }

  private replayResult(
    change: TerminalAuthorityTopologyChange
  ): SshTerminalAuthorityTopologyApplyResult {
    if (change.changeSequence <= this.snapshotSequence) {
      return Object.freeze({ kind: 'duplicate', reason: 'covered-by-snapshot' })
    }
    const expected = this.changeSignatures.get(change.changeSequence)
    if (expected === undefined) {
      return resnapshot('stale-sequence')
    }
    return expected === JSON.stringify(change)
      ? Object.freeze({ kind: 'duplicate', reason: 'exact-replay' })
      : resnapshot('sequence-conflict')
  }

  private rememberChange(change: TerminalAuthorityTopologyChange): void {
    this.changeSignatures.set(change.changeSequence, JSON.stringify(change))
    while (this.changeSignatures.size > MAX_RETAINED_CHANGE_SIGNATURES) {
      const oldest = this.changeSignatures.keys().next().value as number | undefined
      if (oldest === undefined) {
        break
      }
      this.changeSignatures.delete(oldest)
    }
  }
}
