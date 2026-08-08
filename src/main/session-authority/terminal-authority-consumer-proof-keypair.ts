import { getCanonicalUserDataPath } from '../persistence'
import { loadOrCreateE2EEKeypair } from '../runtime/e2ee-keypair'
import type { TerminalAuthorityConsumerProofKeypair } from './terminal-session-authority-consumer-proof'

let keypair: TerminalAuthorityConsumerProofKeypair | null = null

export function getTerminalAuthorityConsumerProofKeypair(): TerminalAuthorityConsumerProofKeypair {
  keypair ??= loadTerminalAuthorityConsumerProofKeypair(getCanonicalUserDataPath())
  return keypair
}

/** Drops the process cache after the reset transaction publishes its successor. */
export function invalidateTerminalAuthorityConsumerProofKeypair(): void {
  keypair = null
}

export function loadTerminalAuthorityConsumerProofKeypair(
  userDataPath: string
): TerminalAuthorityConsumerProofKeypair {
  return loadOrCreateE2EEKeypair(userDataPath)
}
