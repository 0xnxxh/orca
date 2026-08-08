import {
  TERMINAL_AUTHORITY_CONSUMER_PROOF_ALGORITHM,
  TERMINAL_AUTHORITY_CONSUMER_PROOF_CAPABILITY,
  TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION,
  type TerminalAuthorityNamespaceAdmissionChallenge,
  type TerminalAuthorityNamespaceAdmissionIntent,
  type TerminalAuthorityNamespaceAdmissionProof,
  type TerminalAuthorityNamespaceAdmissionStart
} from '../../../shared/terminal-session-authority-consumer-proof'
import type { TerminalAuthorityNamespace } from '../../../shared/terminal-session-authority-identity'
import type { TerminalAuthorityAuthenticatedNamespaceSession } from '../terminal-session-authority-authenticated-consumers'
import type { TerminalAuthorityAuthenticatedConsumerTransport } from '../terminal-session-authority-consumer-admission'
import {
  createTerminalAuthorityConsumerProof,
  createTerminalAuthorityProofEphemeralKeypair,
  type TerminalAuthorityConsumerProofKeypair
} from '../terminal-session-authority-consumer-proof'
import type { TerminalAuthorityPolicyOutcomeTransport } from '../terminal-session-authority-policy-consumers'

/** The real challenge/proof handshake — the only path that reaches a durable consumer claim. */
export type AuthenticatedPolicyConsumerHost = Readonly<{
  issuePolicyConsumerChallenge(
    start: TerminalAuthorityNamespaceAdmissionStart,
    transport: TerminalAuthorityAuthenticatedConsumerTransport
  ): Promise<TerminalAuthorityNamespaceAdmissionChallenge>
  openAuthenticatedPolicyConsumerNamespace(
    proof: TerminalAuthorityNamespaceAdmissionProof,
    authenticatedTransport: TerminalAuthorityAuthenticatedConsumerTransport,
    outcomeTransport: TerminalAuthorityPolicyOutcomeTransport
  ): Promise<TerminalAuthorityAuthenticatedNamespaceSession>
}>

export type AuthenticatedPolicyConsumerAdmission = Readonly<{
  session: TerminalAuthorityAuthenticatedNamespaceSession
  transport: TerminalAuthorityAuthenticatedConsumerTransport
  appKeypair: TerminalAuthorityConsumerProofKeypair
}>

export function terminalAuthorityTestConsumerTransport(
  connectionGrantId = 'test-connection-grant',
  principal = 'daemon-token:test'
): TerminalAuthorityAuthenticatedConsumerTransport {
  return Object.freeze({
    connectionGrantId,
    principal,
    capability: TERMINAL_AUTHORITY_CONSUMER_PROOF_CAPABILITY,
    token: Object.freeze({})
  })
}

export function terminalAuthorityTestAdmissionStart(options: {
  namespace: TerminalAuthorityNamespace
  appKeypair: TerminalAuthorityConsumerProofKeypair
  processIncarnationId: string
  requestId: string
  intent?: TerminalAuthorityNamespaceAdmissionIntent
}): TerminalAuthorityNamespaceAdmissionStart {
  return Object.freeze({
    version: TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION,
    algorithm: TERMINAL_AUTHORITY_CONSUMER_PROOF_ALGORITHM,
    namespace: options.namespace,
    appPublicKeyB64: Buffer.from(options.appKeypair.publicKey).toString('base64'),
    candidateProcessIncarnationId: `app-process:${options.processIncarnationId}`,
    candidateSessionNonce: `session-nonce:${options.processIncarnationId}`,
    requestId: options.requestId,
    intent: options.intent ?? 'first'
  })
}

/** Runs the full challenge -> proof -> admit handshake and returns the installed namespace session. */
export async function admitAuthenticatedPolicyConsumer(
  host: AuthenticatedPolicyConsumerHost,
  options: {
    namespace: TerminalAuthorityNamespace
    transport?: TerminalAuthorityAuthenticatedConsumerTransport
    outcomeTransport?: TerminalAuthorityPolicyOutcomeTransport
    appKeypair?: TerminalAuthorityConsumerProofKeypair
    processIncarnationId?: string
    requestId?: string
    /** 'auto' asks the host which intent its current state requires, then presents exactly that. */
    intent?: TerminalAuthorityNamespaceAdmissionIntent | 'auto'
  }
): Promise<AuthenticatedPolicyConsumerAdmission> {
  const transport = options.transport ?? terminalAuthorityTestConsumerTransport()
  const appKeypair = options.appKeypair ?? createTerminalAuthorityProofEphemeralKeypair()
  const start = terminalAuthorityTestAdmissionStart({
    namespace: options.namespace,
    appKeypair,
    processIncarnationId: options.processIncarnationId ?? 'test-app',
    requestId: options.requestId ?? 'test-request',
    intent: options.intent === 'auto' || !options.intent ? 'first' : options.intent
  })
  const challenge =
    options.intent === undefined || options.intent === 'auto'
      ? await issueChallengeWithRequiredIntent(host, start, transport)
      : await host.issuePolicyConsumerChallenge(start, transport)
  const session = await host.openAuthenticatedPolicyConsumerNamespace(
    createTerminalAuthorityConsumerProof(challenge, appKeypair),
    transport,
    options.outcomeTransport ?? {
      publishBoundary: async () => {},
      publishOutcome: async () => {}
    }
  )
  return Object.freeze({ session, transport, appKeypair })
}

// The host names the only intent its state accepts; a test that does not care re-presents that.
const REQUIRED_INTENTS: readonly TerminalAuthorityNamespaceAdmissionIntent[] = [
  'first',
  'resume',
  'explicit-handover'
]

async function issueChallengeWithRequiredIntent(
  host: AuthenticatedPolicyConsumerHost,
  start: TerminalAuthorityNamespaceAdmissionStart,
  transport: TerminalAuthorityAuthenticatedConsumerTransport
): Promise<TerminalAuthorityNamespaceAdmissionChallenge> {
  try {
    return await host.issuePolicyConsumerChallenge(start, transport)
  } catch (error) {
    const required = REQUIRED_INTENTS.find(
      (intent) =>
        String((error as Error)?.message) ===
        `terminal authority namespace admission requires ${intent}`
    )
    if (!required) {
      throw error
    }
    return await host.issuePolicyConsumerChallenge(
      Object.freeze({ ...start, intent: required }),
      transport
    )
  }
}
