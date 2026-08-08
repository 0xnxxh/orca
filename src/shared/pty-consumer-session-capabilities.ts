import type {
  PtyConsumerSessionGrant,
  PtyConsumerSessionHello,
  PtyConsumerSessionOptions
} from './pty-consumer-session-contract'
import { assertNonEmptyString, MAX_CAPABILITY_VERSIONS } from './pty-consumer-session-hello'
import { TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_VERSION } from './terminal-session-authority-consumer-transport'
import { TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION } from './terminal-session-authority-consumer-proof'
import { assertAuthorityId } from './terminal-session-authority-identity'

export function assertPtyConsumerSessionOptions(options: PtyConsumerSessionOptions): void {
  assertNonEmptyString(options.serverBuildId, 'serverBuildId')
  if (
    options.outputFlowControl &&
    (!Number.isSafeInteger(options.outputFlowControl.maxWindowSu) ||
      options.outputFlowControl.maxWindowSu <= 0 ||
      options.outputFlowControl.versions.length > MAX_CAPABILITY_VERSIONS ||
      options.outputFlowControl.versions.some(
        (version) => !Number.isSafeInteger(version) || version <= 0
      ))
  ) {
    throw new Error('outputFlowControl support is invalid')
  }
  if (
    options.exactOperations &&
    (options.exactOperations.versions.length > MAX_CAPABILITY_VERSIONS ||
      options.exactOperations.versions.some(
        (version) => !Number.isSafeInteger(version) || version <= 0
      ))
  ) {
    throw new Error('exactOperations support is invalid')
  }
  if (
    options.heldProducerPause &&
    (options.heldProducerPause.versions.length > MAX_CAPABILITY_VERSIONS ||
      options.heldProducerPause.versions.some(
        (version) => !Number.isSafeInteger(version) || version <= 0
      ))
  ) {
    throw new Error('heldProducerPause support is invalid')
  }
  if (
    options.terminalAuthorityExactOperations &&
    (options.terminalAuthorityExactOperations.versions.length > MAX_CAPABILITY_VERSIONS ||
      options.terminalAuthorityExactOperations.versions.some(
        (version) => !Number.isSafeInteger(version) || version <= 0
      ))
  ) {
    throw new Error('terminalAuthorityExactOperations support is invalid')
  }
  if (
    options.terminalAuthorityOutcomeDelivery &&
    (options.terminalAuthorityOutcomeDelivery.versions.length > MAX_CAPABILITY_VERSIONS ||
      options.terminalAuthorityOutcomeDelivery.versions.some(
        (version) => !Number.isSafeInteger(version) || version <= 0
      ))
  ) {
    throw new Error('terminalAuthorityOutcomeDelivery support is invalid')
  }
  if (
    options.terminalAuthorityNamespaceOutcomes &&
    (options.terminalAuthorityNamespaceOutcomes.versions.length > MAX_CAPABILITY_VERSIONS ||
      options.terminalAuthorityNamespaceOutcomes.versions.some(
        (version) => !Number.isSafeInteger(version) || version <= 0
      ))
  ) {
    throw new Error('terminalAuthorityNamespaceOutcomes support is invalid')
  }
  if (options.terminalAuthorityConsumerProof) {
    const proof = options.terminalAuthorityConsumerProof
    if (
      proof.versions.length > MAX_CAPABILITY_VERSIONS ||
      proof.versions.some((version) => !Number.isSafeInteger(version) || version <= 0)
    ) {
      throw new Error('terminalAuthorityConsumerProof support is invalid')
    }
    assertAuthorityId(proof.authorityHostId, 'terminal authority proof host id')
    if (
      proof.retirementVersions &&
      (proof.retirementVersions.length > MAX_CAPABILITY_VERSIONS ||
        proof.retirementVersions.some((version) => !Number.isSafeInteger(version) || version <= 0))
    ) {
      throw new Error('terminalAuthorityConsumerProof retirement support is invalid')
    }
  }
  if (
    options.ownerGraceMs !== undefined &&
    (!Number.isSafeInteger(options.ownerGraceMs) || options.ownerGraceMs < 0)
  ) {
    throw new Error('ownerGraceMs must be a non-negative safe integer')
  }
  if (
    options.ownerScope !== undefined &&
    options.ownerScope !== 'global' &&
    options.ownerScope !== 'principal-client-instance'
  ) {
    throw new Error('ownerScope is invalid')
  }
}

export function intersectPtyConsumerCapabilities(
  hello: PtyConsumerSessionHello,
  support: Pick<
    PtyConsumerSessionOptions,
    | 'outputFlowControl'
    | 'exactOperations'
    | 'heldProducerPause'
    | 'terminalAuthorityExactOperations'
    | 'terminalAuthorityOutcomeDelivery'
    | 'terminalAuthorityNamespaceOutcomes'
    | 'terminalAuthorityConsumerProof'
  >
): Pick<PtyConsumerSessionGrant, 'capabilities'> {
  const flowOffer = hello.capabilities?.outputFlowControl
  const flowSupported =
    flowOffer &&
    support.outputFlowControl &&
    flowOffer.versions.includes(1) &&
    support.outputFlowControl.versions.includes(1)
  const exactOffer = hello.capabilities?.exactOperations
  const exactSupported =
    exactOffer &&
    support.exactOperations &&
    exactOffer.versions.includes(1) &&
    support.exactOperations.versions.includes(1)
  const heldPauseOffer = hello.capabilities?.heldProducerPause
  const heldPauseSupported =
    heldPauseOffer &&
    support.heldProducerPause &&
    heldPauseOffer.versions.includes(1) &&
    support.heldProducerPause.versions.includes(1)
  const outcomeOffer = hello.capabilities?.terminalAuthorityOutcomeDelivery
  const authorityExactOffer = hello.capabilities?.terminalAuthorityExactOperations
  const authorityExactSupported =
    authorityExactOffer &&
    support.terminalAuthorityExactOperations &&
    authorityExactOffer.versions.includes(1) &&
    support.terminalAuthorityExactOperations.versions.includes(1)
  const outcomeSupported =
    outcomeOffer &&
    support.terminalAuthorityOutcomeDelivery &&
    outcomeOffer.versions.includes(1) &&
    support.terminalAuthorityOutcomeDelivery.versions.includes(1)
  const consumerProofOffer = hello.capabilities?.terminalAuthorityConsumerProof
  const namespaceOutcomeOffer = hello.capabilities?.terminalAuthorityNamespaceOutcomes
  const namespaceOutcomeSupported =
    namespaceOutcomeOffer &&
    !consumerProofOffer &&
    support.terminalAuthorityNamespaceOutcomes &&
    namespaceOutcomeOffer.versions.includes(TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_VERSION) &&
    support.terminalAuthorityNamespaceOutcomes.versions.includes(
      TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_VERSION
    )
  const consumerProofSupported =
    consumerProofOffer &&
    support.terminalAuthorityConsumerProof &&
    consumerProofOffer.versions.includes(TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION) &&
    support.terminalAuthorityConsumerProof.versions.includes(
      TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION
    )
  const consumerRetirementSupported =
    consumerProofSupported &&
    consumerProofOffer.retirementVersions?.includes(1) &&
    support.terminalAuthorityConsumerProof!.retirementVersions?.includes(1)
  if (
    !flowSupported &&
    !exactSupported &&
    !heldPauseSupported &&
    !authorityExactSupported &&
    !outcomeSupported &&
    !namespaceOutcomeSupported &&
    !consumerProofSupported
  ) {
    return {}
  }
  return {
    capabilities: {
      ...(flowSupported
        ? {
            outputFlowControl: {
              version: 1 as const,
              windowSu: Math.min(
                flowOffer.requestedWindowSu,
                support.outputFlowControl!.maxWindowSu
              )
            }
          }
        : {}),
      ...(exactSupported ? { exactOperations: { version: 1 as const } } : {}),
      ...(heldPauseSupported ? { heldProducerPause: { version: 1 as const } } : {}),
      ...(authorityExactSupported
        ? { terminalAuthorityExactOperations: { version: 1 as const } }
        : {}),
      ...(outcomeSupported ? { terminalAuthorityOutcomeDelivery: { version: 1 as const } } : {}),
      ...(namespaceOutcomeSupported
        ? {
            terminalAuthorityNamespaceOutcomes: {
              version: TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_VERSION,
              consumer: namespaceOutcomeOffer.consumer
            }
          }
        : {}),
      ...(consumerProofSupported
        ? {
            terminalAuthorityConsumerProof: {
              version: TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION,
              authorityHostId: support.terminalAuthorityConsumerProof!.authorityHostId,
              ...(consumerRetirementSupported ? { retirementVersion: 1 as const } : {})
            }
          }
        : {})
    }
  }
}
