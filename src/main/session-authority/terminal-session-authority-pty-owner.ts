import type { TerminalSessionAuthorityRegistry } from './terminal-session-authority-registry'
import {
  TerminalSessionAuthorityPtyLifecycle,
  type TerminalAuthorityAdoptedPtySpawn,
  type TerminalAuthorityManagedPty,
  type TerminalAuthorityPreparedPtySpawn
} from './terminal-session-authority-pty-lifecycle'
import {
  sameTerminalSessionAuthorityPtyAccess,
  type TerminalSessionAuthorityPtyAccess
} from '../../shared/terminal-session-authority-pty-access'
import type { TerminalSessionAuthoritySemanticFact } from '../../shared/terminal-session-authority-mutation'
import type { TerminalSessionAuthorityHostEffectApplier } from './terminal-session-authority-host-effect-applier'
import type {
  TerminalAuthorityPolicyConsumerConnection,
  TerminalAuthorityPolicyConsumerSource,
  TerminalAuthorityPolicyOutcomeTransport
} from './terminal-session-authority-policy-consumers'
import type {
  TerminalAuthorityNamespaceAdmissionChallenge,
  TerminalAuthorityNamespaceAdmissionProof,
  TerminalAuthorityNamespaceAdmissionStart
} from '../../shared/terminal-session-authority-consumer-proof'
import type {
  TerminalAuthorityConsumerRetirementChallenge,
  TerminalAuthorityConsumerRetirementProof,
  TerminalAuthorityConsumerRetirementResult,
  TerminalAuthorityConsumerRetirementStart
} from '../../shared/terminal-session-authority-consumer-retirement'
import type { TerminalAuthorityAuthenticatedConsumerTransport } from './terminal-session-authority-consumer-admission'
import type {
  TerminalAuthorityAuthenticatedNamespacePreparation,
  TerminalAuthorityAuthenticatedNamespaceSession
} from './terminal-session-authority-authenticated-consumers'
import type { TerminalAuthorityNamespace } from '../../shared/terminal-session-authority-identity'

export type TerminalSessionAuthorityPtyPreparation =
  | Readonly<{ kind: 'spawn'; prepared: TerminalAuthorityPreparedPtySpawn }>
  | Readonly<{ kind: 'adopt'; adopted: TerminalAuthorityAdoptedPtySpawn }>

export class TerminalSessionAuthorityPtyOwner {
  private readonly lifecycle: TerminalSessionAuthorityPtyLifecycle
  private readonly managedByPhysicalPtyId = new Map<string, TerminalAuthorityManagedPty>()
  private readonly producerSequences = new Map<string, number>()
  private readonly producerQueues = new Map<string, Promise<void>>()

  constructor(options: { registry: TerminalSessionAuthorityRegistry; ownerIncarnationId: string }) {
    this.lifecycle = new TerminalSessionAuthorityPtyLifecycle(
      options.registry,
      options.ownerIncarnationId
    )
  }

  start(): Promise<void> {
    return this.lifecycle.start()
  }

  installHostEffectApplier(applier: TerminalSessionAuthorityHostEffectApplier): () => void {
    return this.lifecycle.installHostEffectApplier(applier)
  }

  issuePolicyConsumerChallenge(
    start: TerminalAuthorityNamespaceAdmissionStart,
    transport: TerminalAuthorityAuthenticatedConsumerTransport
  ): Promise<TerminalAuthorityNamespaceAdmissionChallenge> {
    return this.lifecycle.issuePolicyConsumerChallenge(start, transport)
  }

  issuePolicyConsumerRetirementChallenge(
    start: TerminalAuthorityConsumerRetirementStart,
    transport: TerminalAuthorityAuthenticatedConsumerTransport
  ): Promise<TerminalAuthorityConsumerRetirementChallenge> {
    return this.lifecycle.issuePolicyConsumerRetirementChallenge(start, transport)
  }

  retireAuthenticatedPolicyConsumer(
    proof: TerminalAuthorityConsumerRetirementProof,
    transport: TerminalAuthorityAuthenticatedConsumerTransport
  ): Promise<TerminalAuthorityConsumerRetirementResult> {
    return this.lifecycle.retireAuthenticatedPolicyConsumer(proof, transport)
  }

  resolvePolicyConsumerNamespace(worktreeId: string): Promise<TerminalAuthorityNamespace> {
    return this.lifecycle.resolvePolicyConsumerNamespace(worktreeId)
  }

  openAuthenticatedPolicyConsumerNamespace(
    proof: TerminalAuthorityNamespaceAdmissionProof,
    authenticatedTransport: TerminalAuthorityAuthenticatedConsumerTransport,
    outcomeTransport: TerminalAuthorityPolicyOutcomeTransport
  ): Promise<TerminalAuthorityAuthenticatedNamespaceSession> {
    return this.lifecycle.openAuthenticatedPolicyConsumerNamespace(
      proof,
      authenticatedTransport,
      outcomeTransport
    )
  }

  prepareAuthenticatedPolicyConsumerNamespace(
    proof: TerminalAuthorityNamespaceAdmissionProof,
    authenticatedTransport: TerminalAuthorityAuthenticatedConsumerTransport,
    outcomeTransport: TerminalAuthorityPolicyOutcomeTransport
  ): Promise<TerminalAuthorityAuthenticatedNamespacePreparation> {
    return this.lifecycle.prepareAuthenticatedPolicyConsumerNamespace(
      proof,
      authenticatedTransport,
      outcomeTransport
    )
  }

  releaseAuthenticatedPolicyConsumerTransport(transportToken: object): void {
    this.lifecycle.releaseAuthenticatedPolicyConsumerTransport(transportToken)
  }

  policyConsumerTransportInstalled(): boolean {
    return this.lifecycle.policyConsumerTransportInstalled()
  }

  hostEffectConsumerInstalled(): boolean {
    return this.lifecycle.hostEffectConsumerInstalled()
  }

  requestHostEffectDelivery(): void {
    this.lifecycle.requestHostEffectDelivery()
  }

  dispose(): void {
    this.lifecycle.dispose()
  }

  async prepareSpawn(
    params: Record<string, unknown>,
    physicalPtyId: string,
    policyConsumer: TerminalAuthorityPolicyConsumerSource,
    operationId?: string
  ): Promise<TerminalSessionAuthorityPtyPreparation> {
    const prepared = await this.lifecycle.prepareSpawn(
      params,
      physicalPtyId,
      policyConsumer,
      operationId
    )
    return prepared.kind === 'spawn'
      ? Object.freeze({ kind: 'spawn', prepared })
      : Object.freeze({ kind: 'adopt', adopted: prepared })
  }

  async commitSpawn(
    prepared: TerminalAuthorityPreparedPtySpawn,
    ptyIncarnationId: string
  ): Promise<TerminalSessionAuthorityPtyAccess> {
    const managed = await this.lifecycle.commitSpawn(prepared, ptyIncarnationId)
    this.remember(managed)
    return accessForManagedPty(managed)
  }

  adopt(
    adopted: TerminalAuthorityAdoptedPtySpawn,
    physicalPtyId: string,
    ptyIncarnationId: string
  ): TerminalSessionAuthorityPtyAccess | null {
    if (
      adopted.binding.physicalPtyId !== physicalPtyId ||
      adopted.binding.ptyIncarnationId !== ptyIncarnationId ||
      !this.lifecycle.bindingIsReachable(this.lifecycle.managedFromAdoption(adopted))
    ) {
      return null
    }
    const managed = this.lifecycle.managedFromAdoption(adopted)
    this.remember(managed)
    return accessForManagedPty(managed)
  }

  accessFor(physicalPtyId: string): TerminalSessionAuthorityPtyAccess | null {
    const managed = this.managedByPhysicalPtyId.get(physicalPtyId)
    if (!managed || !this.lifecycle.bindingIsReachable(managed)) {
      return null
    }
    return accessForManagedPty(managed)
  }

  admits(physicalPtyId: string, access: TerminalSessionAuthorityPtyAccess): boolean {
    return sameTerminalSessionAuthorityPtyAccess(this.accessFor(physicalPtyId), access)
  }

  /**
   * Returns false when the PTY no longer holds this exact binding; the caller
   * must not retarget the fact at a successor.
   */
  async recordSemanticOutcome(
    physicalPtyId: string,
    access: TerminalSessionAuthorityPtyAccess,
    fact: TerminalSessionAuthoritySemanticFact
  ): Promise<boolean> {
    const managed = this.managedByPhysicalPtyId.get(physicalPtyId)
    if (!managed || !sameTerminalSessionAuthorityPtyAccess(accessForManagedPty(managed), access)) {
      return false
    }
    const producerKey = semanticProducerKey(access)
    return this.enqueueProducer(producerKey, async () => {
      if (
        this.managedByPhysicalPtyId.get(physicalPtyId) !== managed ||
        !sameTerminalSessionAuthorityPtyAccess(accessForManagedPty(managed), access)
      ) {
        return false
      }
      const producerSequence = (this.producerSequences.get(producerKey) ?? 0) + 1
      await this.lifecycle.recordSemanticFact(managed, access, producerSequence, fact)
      this.producerSequences.set(producerKey, producerSequence)
      return true
    })
  }

  async recordExit(
    physicalPtyId: string,
    ptyIncarnationId: string,
    code: number | null
  ): Promise<void> {
    const managed = this.managedByPhysicalPtyId.get(physicalPtyId)
    if (!managed || managed.binding.ptyIncarnationId !== ptyIncarnationId) {
      return
    }
    const producerKey = semanticProducerKey(accessForManagedPty(managed))
    await this.enqueueProducer(producerKey, async () => {
      if (this.managedByPhysicalPtyId.get(physicalPtyId) !== managed) {
        return
      }
      await this.lifecycle.recordExit(managed, code)
      this.producerSequences.delete(producerKey)
      if (this.managedByPhysicalPtyId.get(physicalPtyId) === managed) {
        this.managedByPhysicalPtyId.delete(physicalPtyId)
      }
    })
  }

  async close(
    physicalPtyId: string,
    access: TerminalSessionAuthorityPtyAccess,
    policyConsumer: TerminalAuthorityPolicyConsumerConnection,
    operationId?: string
  ): Promise<boolean> {
    const managed = this.managedByPhysicalPtyId.get(physicalPtyId)
    if (!managed || !sameTerminalSessionAuthorityPtyAccess(accessForManagedPty(managed), access)) {
      return false
    }
    const producerKey = semanticProducerKey(access)
    return this.enqueueProducer(producerKey, async () => {
      if (
        this.managedByPhysicalPtyId.get(physicalPtyId) !== managed ||
        !sameTerminalSessionAuthorityPtyAccess(accessForManagedPty(managed), access)
      ) {
        return false
      }
      await this.lifecycle.closePty(managed, policyConsumer, operationId)
      this.producerSequences.delete(producerKey)
      if (this.managedByPhysicalPtyId.get(physicalPtyId) === managed) {
        this.managedByPhysicalPtyId.delete(physicalPtyId)
      }
      return true
    })
  }

  async cancelSpawn(prepared: TerminalAuthorityPreparedPtySpawn): Promise<void> {
    await this.lifecycle.cancelSpawn(prepared)
  }

  private remember(managed: TerminalAuthorityManagedPty): void {
    this.managedByPhysicalPtyId.set(managed.binding.physicalPtyId, managed)
  }

  private enqueueProducer<T>(producerKey: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.producerQueues.get(producerKey) ?? Promise.resolve()
    const result = previous.then(operation)
    const settled = result.then(
      () => undefined,
      () => undefined
    )
    this.producerQueues.set(producerKey, settled)
    void settled.then(() => {
      if (this.producerQueues.get(producerKey) === settled) {
        this.producerQueues.delete(producerKey)
      }
    })
    return result
  }
}

function semanticProducerKey(access: TerminalSessionAuthorityPtyAccess): string {
  return JSON.stringify([
    access.namespace.authorityHostId,
    access.namespace.namespaceId,
    access.pane.paneKey,
    access.pane.paneGenerationId,
    access.binding.ownerIncarnationId,
    access.binding.physicalPtyId,
    access.binding.ptyIncarnationId
  ])
}

function accessForManagedPty(
  managed: TerminalAuthorityManagedPty
): TerminalSessionAuthorityPtyAccess {
  return Object.freeze({
    namespace: Object.freeze({ ...managed.runtime.service.namespace }),
    pane: Object.freeze({ ...managed.pane }),
    binding: Object.freeze({ ...managed.binding })
  })
}
