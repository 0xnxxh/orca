import {
  TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_ALGORITHM,
  TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_VERSION,
  parseTerminalAuthorityConsumerRetirementChallenge,
  parseTerminalAuthorityConsumerRetirementResult,
  parseTerminalAuthorityConsumerRetirementStart,
  type TerminalAuthorityConsumerRetirementChallenge,
  type TerminalAuthorityConsumerRetirementResult,
  type TerminalAuthorityConsumerRetirementStart
} from '../../shared/terminal-session-authority-consumer-retirement'
import type { TerminalAuthorityAppConsumerRetirementRequest } from './terminal-authority-app-outcome-host-contract'
import {
  createTerminalAuthorityConsumerRetirementProof,
  terminalAuthorityHostAppConsumerId,
  type TerminalAuthorityConsumerProofKeypair
} from './terminal-session-authority-consumer-proof'

export async function retireTerminalAuthorityAppConsumer(options: {
  authenticatedAuthorityHostId: string
  keypair: TerminalAuthorityConsumerProofKeypair
  request: TerminalAuthorityAppConsumerRetirementRequest
  issueChallenge(start: TerminalAuthorityConsumerRetirementStart): Promise<unknown>
  complete(
    proof: ReturnType<typeof createTerminalAuthorityConsumerRetirementProof>
  ): Promise<unknown>
}): Promise<TerminalAuthorityConsumerRetirementResult> {
  const start = terminalAuthorityAppConsumerRetirementStart(
    options.authenticatedAuthorityHostId,
    options.keypair,
    options.request
  )
  const challenge = requireTerminalAuthorityAppConsumerRetirementChallenge(
    await options.issueChallenge(start),
    options.authenticatedAuthorityHostId,
    options.keypair,
    start
  )
  const proof = createTerminalAuthorityConsumerRetirementProof(challenge, options.keypair)
  return requireTerminalAuthorityAppConsumerRetirementResult(
    await options.complete(proof),
    challenge
  )
}

export function terminalAuthorityAppConsumerRetirementStart(
  authenticatedAuthorityHostId: string,
  keypair: TerminalAuthorityConsumerProofKeypair,
  request: TerminalAuthorityAppConsumerRetirementRequest
): TerminalAuthorityConsumerRetirementStart {
  const start = parseTerminalAuthorityConsumerRetirementStart({
    version: TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_VERSION,
    algorithm: TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_ALGORITHM,
    ...request,
    appPublicKeyB64: Buffer.from(keypair.publicKey).toString('base64')
  })
  if (!start || start.namespace.authorityHostId !== authenticatedAuthorityHostId) {
    throw new Error('terminal authority consumer retirement request is invalid')
  }
  return start
}

export function requireTerminalAuthorityAppConsumerRetirementChallenge(
  unsafeChallenge: unknown,
  authenticatedAuthorityHostId: string,
  keypair: TerminalAuthorityConsumerProofKeypair,
  start: TerminalAuthorityConsumerRetirementStart
): TerminalAuthorityConsumerRetirementChallenge {
  const challenge = parseTerminalAuthorityConsumerRetirementChallenge(unsafeChallenge)
  const expectedConsumerId = terminalAuthorityHostAppConsumerId(
    authenticatedAuthorityHostId,
    keypair.publicKey
  )
  if (!challenge || !sameStart(challenge, start) || challenge.consumerId !== expectedConsumerId) {
    throw new Error('terminal authority consumer retirement challenge is invalid')
  }
  return challenge
}

export function requireTerminalAuthorityAppConsumerRetirementResult(
  unsafeResult: unknown,
  challenge: TerminalAuthorityConsumerRetirementChallenge
): TerminalAuthorityConsumerRetirementResult {
  const result = parseTerminalAuthorityConsumerRetirementResult(unsafeResult)
  if (
    !result ||
    result.namespace.authorityHostId !== challenge.namespace.authorityHostId ||
    result.namespace.namespaceId !== challenge.namespace.namespaceId ||
    result.consumerId !== challenge.consumerId ||
    result.retiredConsumerIncarnationId !== challenge.currentConsumerIncarnationId ||
    result.requestId !== challenge.requestId ||
    result.candidateProcessIncarnationId !== challenge.candidateProcessIncarnationId ||
    result.candidateSessionNonce !== challenge.candidateSessionNonce ||
    result.connectionGrantId !== challenge.connectionGrantId ||
    result.retirementCas !== challenge.retirementCas
  ) {
    throw new Error('terminal authority consumer retirement result is invalid')
  }
  return result
}

function sameStart(
  challenge: TerminalAuthorityConsumerRetirementChallenge,
  start: TerminalAuthorityConsumerRetirementStart
): boolean {
  return (
    challenge.version === start.version &&
    challenge.algorithm === start.algorithm &&
    challenge.namespace.authorityHostId === start.namespace.authorityHostId &&
    challenge.namespace.namespaceId === start.namespace.namespaceId &&
    challenge.appPublicKeyB64 === start.appPublicKeyB64 &&
    challenge.candidateProcessIncarnationId === start.candidateProcessIncarnationId &&
    challenge.candidateSessionNonce === start.candidateSessionNonce &&
    challenge.requestId === start.requestId
  )
}
