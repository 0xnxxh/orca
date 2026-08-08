import type { PtyConsumerSessionHello } from './pty-consumer-session-contract'
import {
  TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_VERSION,
  parseTerminalAuthorityPolicyConsumerClaim
} from './terminal-session-authority-consumer-identity'

export const MAX_CAPABILITY_VERSIONS = 8

function validateCapabilityVersions(value: unknown, name: string): void {
  if (
    !Array.isArray(value) ||
    value.length > MAX_CAPABILITY_VERSIONS ||
    value.some((version) => !Number.isSafeInteger(version) || version <= 0)
  ) {
    throw new Error(`${name} must contain positive safe integers`)
  }
}

export function assertNonEmptyString(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) {
    throw new Error(`${name} must be a non-empty string of at most 512 characters`)
  }
}

export function validateHello(hello: PtyConsumerSessionHello): void {
  assertNonEmptyString(hello.clientInstanceId, 'clientInstanceId')
  if (hello.requestedRole !== 'session-owner' && hello.requestedRole !== 'subscriber') {
    throw new Error('requestedRole must be session-owner or subscriber')
  }
  if (hello.resume) {
    if (!Number.isSafeInteger(hello.resume.ownerGeneration) || hello.resume.ownerGeneration <= 0) {
      throw new Error('resume.ownerGeneration must be a positive safe integer')
    }
    assertNonEmptyString(hello.resume.ownerLease, 'resume.ownerLease')
  }
  const flow = hello.capabilities?.outputFlowControl
  if (flow) {
    validateCapabilityVersions(flow.versions, 'outputFlowControl.versions')
    if (!Number.isSafeInteger(flow.requestedWindowSu) || flow.requestedWindowSu <= 0) {
      throw new Error('outputFlowControl.requestedWindowSu must be a positive safe integer')
    }
  }
  const exact = hello.capabilities?.exactOperations
  if (exact) {
    validateCapabilityVersions(exact.versions, 'exactOperations.versions')
  }
  const heldPause = hello.capabilities?.heldProducerPause
  if (heldPause) {
    validateCapabilityVersions(heldPause.versions, 'heldProducerPause.versions')
  }
  const authorityExact = hello.capabilities?.terminalAuthorityExactOperations
  if (authorityExact) {
    validateCapabilityVersions(authorityExact.versions, 'terminalAuthorityExactOperations.versions')
  }
  const outcomeDelivery = hello.capabilities?.terminalAuthorityOutcomeDelivery
  if (outcomeDelivery) {
    validateCapabilityVersions(
      outcomeDelivery.versions,
      'terminalAuthorityOutcomeDelivery.versions'
    )
  }
  const namespaceOutcomes = hello.capabilities?.terminalAuthorityNamespaceOutcomes
  if (namespaceOutcomes) {
    validateCapabilityVersions(
      namespaceOutcomes.versions,
      'terminalAuthorityNamespaceOutcomes.versions'
    )
    if (
      !namespaceOutcomes.versions.includes(TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_VERSION) ||
      !parseTerminalAuthorityPolicyConsumerClaim({
        version: TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_VERSION,
        consumer: namespaceOutcomes.consumer,
        expectedConsumerIncarnationId: namespaceOutcomes.expectedConsumerIncarnationId
      })
    ) {
      throw new Error('terminalAuthorityNamespaceOutcomes claim is invalid')
    }
  }
  const consumerProof = hello.capabilities?.terminalAuthorityConsumerProof
  if (consumerProof) {
    validateCapabilityVersions(consumerProof.versions, 'terminalAuthorityConsumerProof.versions')
    if (consumerProof.retirementVersions) {
      validateCapabilityVersions(
        consumerProof.retirementVersions,
        'terminalAuthorityConsumerProof.retirementVersions'
      )
    }
  }
  const topology = hello.capabilities?.terminalAuthorityTopology
  if (topology) {
    validateCapabilityVersions(topology.versions, 'terminalAuthorityTopology.versions')
  }
}
