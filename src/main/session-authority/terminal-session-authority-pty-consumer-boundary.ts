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
import type { TerminalAuthorityNamespace } from '../../shared/terminal-session-authority-identity'
import type { TerminalAuthorityAuthenticatedConsumerTransport } from './terminal-session-authority-consumer-admission'
import {
  TerminalSessionAuthorityAuthenticatedConsumers,
  type TerminalAuthorityAuthenticatedNamespacePreparation,
  type TerminalAuthorityAuthenticatedNamespaceSession
} from './terminal-session-authority-authenticated-consumers'
import {
  TerminalSessionAuthorityHostEffectApplierSlot,
  type TerminalSessionAuthorityHostEffectApplier
} from './terminal-session-authority-host-effect-applier'
import { TerminalSessionAuthorityHostEffectConsumer } from './terminal-session-authority-host-effect-consumer'
import {
  TerminalSessionAuthorityPolicyConsumers,
  type TerminalAuthorityPolicyOutcomeTransport
} from './terminal-session-authority-policy-consumers'
import type { TerminalSessionAuthorityRegistry } from './terminal-session-authority-registry'
import { terminalAuthorityLocatorForWorktreeId } from './terminal-session-authority-spawn-state'

export class TerminalSessionAuthorityPtyConsumerBoundary {
  private readonly hostEffectApplier = new TerminalSessionAuthorityHostEffectApplierSlot()
  protected readonly hostEffectConsumer: TerminalSessionAuthorityHostEffectConsumer
  private readonly policyConsumers = new TerminalSessionAuthorityPolicyConsumers()
  private readonly authenticatedConsumers: TerminalSessionAuthorityAuthenticatedConsumers

  constructor(
    private readonly authorityRegistry: TerminalSessionAuthorityRegistry,
    ownerIncarnationId: string
  ) {
    this.hostEffectConsumer = new TerminalSessionAuthorityHostEffectConsumer(
      authorityRegistry,
      ownerIncarnationId,
      this.hostEffectApplier
    )
    this.authenticatedConsumers = new TerminalSessionAuthorityAuthenticatedConsumers(
      authorityRegistry,
      this.policyConsumers
    )
  }

  start(): Promise<void> {
    return this.hostEffectConsumer.start()
  }

  installHostEffectApplier(applier: TerminalSessionAuthorityHostEffectApplier): () => void {
    const remove = this.hostEffectApplier.install(applier)
    this.hostEffectConsumer.requestAll()
    return remove
  }

  issuePolicyConsumerChallenge(
    start: TerminalAuthorityNamespaceAdmissionStart,
    transport: TerminalAuthorityAuthenticatedConsumerTransport
  ): Promise<TerminalAuthorityNamespaceAdmissionChallenge> {
    return this.authenticatedConsumers.issueChallenge(start, transport)
  }

  issuePolicyConsumerRetirementChallenge(
    start: TerminalAuthorityConsumerRetirementStart,
    transport: TerminalAuthorityAuthenticatedConsumerTransport
  ): Promise<TerminalAuthorityConsumerRetirementChallenge> {
    return this.authenticatedConsumers.issueRetirementChallenge(start, transport)
  }

  retireAuthenticatedPolicyConsumer(
    proof: TerminalAuthorityConsumerRetirementProof,
    transport: TerminalAuthorityAuthenticatedConsumerTransport
  ): Promise<TerminalAuthorityConsumerRetirementResult> {
    return this.authenticatedConsumers.retireConsumer(proof, transport)
  }

  async resolvePolicyConsumerNamespace(worktreeId: string): Promise<TerminalAuthorityNamespace> {
    const locator = terminalAuthorityLocatorForWorktreeId(worktreeId)
    const existing = this.authorityRegistry.namespaceForLocator(locator)
    return existing ?? (await this.authorityRegistry.resolveNamespace(locator)).namespace
  }

  openAuthenticatedPolicyConsumerNamespace(
    proof: TerminalAuthorityNamespaceAdmissionProof,
    authenticatedTransport: TerminalAuthorityAuthenticatedConsumerTransport,
    outcomeTransport: TerminalAuthorityPolicyOutcomeTransport
  ): Promise<TerminalAuthorityAuthenticatedNamespaceSession> {
    return this.authenticatedConsumers.openNamespace(
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
    return this.authenticatedConsumers.prepareNamespace(
      proof,
      authenticatedTransport,
      outcomeTransport
    )
  }

  releaseAuthenticatedPolicyConsumerTransport(transportToken: object): void {
    this.authenticatedConsumers.releaseTransport(transportToken)
  }

  policyConsumerTransportInstalled(): boolean {
    return this.policyConsumers.hasInstalledTransport()
  }

  hostEffectConsumerInstalled(): boolean {
    return this.hostEffectApplier.isInstalled()
  }

  requestHostEffectDelivery(): void {
    this.hostEffectConsumer.requestAll()
  }

  dispose(): void {
    this.authenticatedConsumers.dispose()
    this.policyConsumers.dispose()
    this.hostEffectConsumer.dispose()
  }
}
