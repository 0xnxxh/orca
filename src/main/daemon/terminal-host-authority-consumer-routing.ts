import type { CreateOrAttachOptions } from './terminal-host-create-contract'
import type { InternalCreateOrAttachOptions } from './terminal-host-agent-session-claim'
import type { TerminalAuthorityPolicyConsumerSource } from '../session-authority/terminal-session-authority-policy-consumers'

export function requireTerminalHostAuthorityConsumerSource(
  options: CreateOrAttachOptions,
  ptyOwnerAvailable: boolean
): TerminalAuthorityPolicyConsumerSource {
  const policyConsumer = options.terminalSessionAuthorityPolicyConsumer
  if (!ptyOwnerAvailable || !policyConsumer) {
    throw new Error('terminal_session_authority_outcome_consumer_required')
  }
  return policyConsumer
}

export function authorityTerminalStreamClient(
  options: InternalCreateOrAttachOptions,
  ptyOwnerAvailable: boolean
): InternalCreateOrAttachOptions['streamClient'] {
  requireTerminalHostAuthorityConsumerSource(options, ptyOwnerAvailable)
  return { ...options.streamClient, onExit: () => undefined }
}
