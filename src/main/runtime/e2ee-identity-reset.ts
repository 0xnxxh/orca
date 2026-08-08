import { randomBytes } from 'node:crypto'
import type { RelayDeviceBinding, RelayRevokeOutboxItem } from './relay/relay-revoke-outbox'
import type { E2EEKeypair, E2EEKeypairResetTransaction } from './e2ee-keypair'
import {
  finalizeE2EEKeypairResetSuccessor,
  loadE2EEKeypair,
  isE2EEKeypairResetResidueAbsent,
  publishE2EEKeypairResetSuccessor,
  removeE2EEKeypairResetResidue,
  stageE2EEKeypairResetSuccessor
} from './e2ee-keypair'
import {
  E2EEIdentityResetRecordStore,
  phaseIndex,
  resetTargetsFromNamespaces,
  resetTargetsFromAuthorityTargets,
  type E2EEIdentityResetPhase,
  type E2EEIdentityResetRecord,
  type E2EEIdentityResetTarget
} from './e2ee-identity-reset-record'
import type { TerminalAuthorityConsumerRetirementResult } from '../../shared/terminal-session-authority-consumer-retirement'
import type { TerminalAuthorityAppConsumerRetirementRequest } from '../session-authority/terminal-authority-app-outcome-host-contract'

export type E2EEIdentityResetAuthorityTarget = Readonly<{
  target: E2EEIdentityResetTarget
  retireNamespace(
    namespaceId: string,
    request: TerminalAuthorityAppConsumerRetirementRequest
  ): Promise<TerminalAuthorityConsumerRetirementResult>
}>

export type E2EEIdentityResetDependencies = Readonly<{
  userDataPath: string
  currentKeypair(): E2EEKeypair | null
  listAuthorityTargets(): readonly E2EEIdentityResetAuthorityTarget[]
  freezeAuthorityAdmissions(): void
  unfreezeAuthorityAdmissions(): void
  closeLiveTransports(): Promise<void>
  listRelayBindings(): readonly RelayDeviceBinding[]
  enqueueRelayRevoke(binding: RelayDeviceBinding): RelayRevokeOutboxItem
  awaitRelayRevocations(items: readonly RelayRevokeOutboxItem[]): Promise<void>
  removeLocalCredentials(): void | Promise<void>
  onSuccessorPublished(keypair: E2EEKeypair): void | Promise<void>
  onReEnrollment(): void | Promise<void>
  processIncarnationId?: string
  getProcessIncarnationId?: () => string | null
  createSessionNonce?: () => string
}>

export type E2EEIdentityResetStatus = Readonly<{
  inProgress: boolean
  record: E2EEIdentityResetRecord | null
}>

export type E2EEIdentityResetResult = Readonly<{
  transactionId: string
  successorPublicKeyB64: string
  phase: 're-enrollment'
}>

export class E2EEIdentityResetCoordinator {
  private readonly store: E2EEIdentityResetRecordStore
  private readonly processIncarnationId: string
  private readonly sessionNonce: string
  private inFlight: Promise<E2EEIdentityResetResult> | null = null
  private admissionsFrozen = false

  constructor(private readonly dependencies: E2EEIdentityResetDependencies) {
    this.store = new E2EEIdentityResetRecordStore(dependencies.userDataPath)
    this.processIncarnationId =
      dependencies.processIncarnationId ?? `app-process:${randomBytes(16).toString('hex')}`
    this.sessionNonce =
      dependencies.createSessionNonce?.() ?? `app-session:${randomBytes(16).toString('hex')}`
  }

  status(): E2EEIdentityResetStatus {
    const record = this.store.read()
    return Object.freeze({ inProgress: this.admissionsFrozen || record !== null, record })
  }

  hasPendingRecord(): boolean {
    return this.store.read() !== null
  }

  run(): Promise<E2EEIdentityResetResult> {
    this.inFlight ??= this.runExclusive().finally(() => {
      this.inFlight = null
    })
    return this.inFlight
  }

  private async runExclusive(): Promise<E2EEIdentityResetResult> {
    let record = this.store.read()
    this.freezeOnce()
    if (!record) {
      const current = this.dependencies.currentKeypair()
      if (!current) {
        throw new Error('E2EE identity reset requires an established identity')
      }
      const authorityTargets = this.dependencies.listAuthorityTargets()
      const namespaces = authorityTargets.flatMap((entry) =>
        entry.target.namespaceIds.map((namespaceId) => ({
          authorityHostId: entry.target.authorityHostId,
          namespaceId
        }))
      )
      record = this.store.create(current.publicKeyB64, resetTargetsFromNamespaces(namespaces))
    }

    if (record.phase === 'retiring-hosts') {
      this.assertTargetShape(record)
      await this.retireHosts(record)
      record = this.advance(record, 'revoking-relay')
    }
    if (record.phase === 'revoking-relay') {
      await this.revokeRelayBindings()
      record = this.advance(record, 'closing-transports')
    }
    if (record.phase === 'closing-transports') {
      await this.dependencies.closeLiveTransports()
      record = this.advance(record, 'removing-local-credentials')
    }
    if (record.phase === 'removing-local-credentials') {
      await this.dependencies.removeLocalCredentials()
      record = this.advance(record, 'creating-successor')
    }

    const creating: E2EEKeypairResetTransaction = {
      transactionId: record.transactionId,
      oldPublicKeyB64: record.oldPublicKeyB64,
      phase: 'creating-successor'
    }
    let successor: E2EEKeypair
    if (record.phase === 'creating-successor') {
      stageE2EEKeypairResetSuccessor(this.dependencies.userDataPath, creating)
      successor = publishE2EEKeypairResetSuccessor(this.dependencies.userDataPath, creating)
      record = this.advance(record, 'successor-published')
    } else {
      successor = loadE2EEKeypair(this.dependencies.userDataPath)
    }
    if (record.phase === 'successor-published') {
      await this.dependencies.onSuccessorPublished(successor)
      const loadedSuccessor = loadE2EEKeypair(this.dependencies.userDataPath)
      if (loadedSuccessor.publicKeyB64 !== successor.publicKeyB64) {
        throw new Error('E2EE reset successor failed strict-loader verification')
      }
      record = this.advance(record, 'finalizing-successor')
    }
    const finalizing: E2EEKeypairResetTransaction = {
      ...creating,
      phase: 'finalizing-successor'
    }
    let finalized = successor
    if (record.phase === 'finalizing-successor') {
      try {
        finalized = finalizeE2EEKeypairResetSuccessor(this.dependencies.userDataPath, finalizing)
        removeE2EEKeypairResetResidue(this.dependencies.userDataPath, finalizing)
      } catch (error) {
        if (!isE2EEKeypairResetResidueAbsent(this.dependencies.userDataPath, finalizing)) {
          throw error
        }
        finalized = loadE2EEKeypair(this.dependencies.userDataPath)
      }
      await this.dependencies.onReEnrollment()
      record = this.advance(record, 're-enrollment')
    }
    this.store.remove(record)
    this.dependencies.unfreezeAuthorityAdmissions()
    this.admissionsFrozen = false
    return Object.freeze({
      transactionId: record.transactionId,
      successorPublicKeyB64: finalized.publicKeyB64,
      phase: 're-enrollment'
    })
  }

  private freezeOnce(): void {
    if (this.admissionsFrozen) {
      return
    }
    this.dependencies.freezeAuthorityAdmissions()
    this.admissionsFrozen = true
  }

  private async retireHosts(record: E2EEIdentityResetRecord): Promise<void> {
    if (record.phase !== 'retiring-hosts') {
      return
    }
    const targets = this.dependencies.listAuthorityTargets()
    const byHost = new Map(targets.map((entry) => [entry.target.authorityHostId, entry]))
    const processIncarnationId =
      this.dependencies.getProcessIncarnationId?.() ?? this.processIncarnationId
    for (const target of record.targets) {
      const authority = byHost.get(target.authorityHostId)
      if (!authority) {
        throw new Error(`E2EE identity reset host is unresolved: ${target.authorityHostId}`)
      }
      const namespaces = new Set(authority.target.namespaceIds)
      for (const namespaceId of target.namespaceIds) {
        if (!namespaces.has(namespaceId)) {
          throw new Error(`E2EE identity reset namespace is unresolved: ${namespaceId}`)
        }
        const result = await authority.retireNamespace(namespaceId, {
          namespace: Object.freeze({
            authorityHostId: target.authorityHostId,
            namespaceId
          }),
          candidateProcessIncarnationId: processIncarnationId,
          candidateSessionNonce: this.sessionNonce,
          requestId: this.retirementRequestId(
            record.transactionId,
            target.authorityHostId,
            namespaceId
          )
        })
        if (
          result.retired !== true ||
          result.namespace.authorityHostId !== target.authorityHostId ||
          result.namespace.namespaceId !== namespaceId ||
          result.candidateProcessIncarnationId !== processIncarnationId ||
          result.candidateSessionNonce !== this.sessionNonce ||
          result.requestId !==
            this.retirementRequestId(record.transactionId, target.authorityHostId, namespaceId)
        ) {
          throw new Error(
            `E2EE identity reset retirement acknowledgement is invalid: ${namespaceId}`
          )
        }
      }
    }
  }

  private async revokeRelayBindings(): Promise<void> {
    const bindings = this.dependencies.listRelayBindings()
    const unique = new Map<string, RelayDeviceBinding>()
    for (const binding of bindings) {
      unique.set(
        `${binding.relayHostId}\0${binding.relayDeviceId}\0${binding.ownerIdentityKey}`,
        binding
      )
    }
    const items = [...unique.values()].map((binding) =>
      this.dependencies.enqueueRelayRevoke(binding)
    )
    await this.dependencies.awaitRelayRevocations(items)
  }

  private advance(
    record: E2EEIdentityResetRecord,
    phase: E2EEIdentityResetPhase
  ): E2EEIdentityResetRecord {
    if (phaseIndex(record.phase) >= phaseIndex(phase)) {
      return record
    }
    return this.store.advance(record, phase)
  }

  private assertTargetShape(record: E2EEIdentityResetRecord): void {
    const targets = this.dependencies.listAuthorityTargets()
    const available = new Set(
      resetTargetsFromAuthorityTargets(targets.map((entry) => entry.target)).flatMap((target) => [
        `${target.authorityHostId}\0`,
        ...target.namespaceIds.map((namespaceId) => `${target.authorityHostId}\0${namespaceId}`)
      ])
    )
    for (const target of record.targets) {
      if (!available.has(`${target.authorityHostId}\0`)) {
        throw new Error(`E2EE identity reset host is unresolved: ${target.authorityHostId}`)
      }
      for (const namespaceId of target.namespaceIds) {
        if (!available.has(`${target.authorityHostId}\0${namespaceId}`)) {
          throw new Error(`E2EE identity reset target is no longer known: ${namespaceId}`)
        }
      }
    }
  }

  private retirementRequestId(
    transactionId: string,
    authorityHostId: string,
    namespaceId: string
  ): string {
    return `identity-reset:${transactionId}:${encodePart(authorityHostId)}:${encodePart(namespaceId)}`
  }
}

function encodePart(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}
