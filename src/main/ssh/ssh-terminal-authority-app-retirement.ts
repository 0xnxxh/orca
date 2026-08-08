import type { TerminalAuthorityAppConsumerRetirementRequest } from '../session-authority/terminal-authority-app-outcome-host-contract'
import { retireTerminalAuthorityAppConsumer } from '../session-authority/terminal-authority-app-consumer-retirement'
import type { SshTerminalAuthorityAppHostTransportOptions } from './ssh-terminal-authority-app-host-transport'
import {
  SSH_TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_CHALLENGE_METHOD,
  SSH_TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_METHOD
} from './ssh-terminal-authority-consumer-methods'

export async function retireSshTerminalAuthorityAppConsumer(
  options: SshTerminalAuthorityAppHostTransportOptions,
  request: TerminalAuthorityAppConsumerRetirementRequest,
  assertCurrent: () => void
) {
  assertCurrent()
  if (!options.consumerRetirementSupported) {
    throw new Error('SSH terminal authority consumer retirement is unsupported')
  }
  const result = await retireTerminalAuthorityAppConsumer({
    authenticatedAuthorityHostId: options.authenticatedAuthorityHostId,
    keypair: options.keypair,
    request,
    issueChallenge: (start) =>
      options.mux.request(SSH_TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_CHALLENGE_METHOD, { start }),
    complete: (proof) =>
      options.mux.request(SSH_TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_METHOD, { proof })
  })
  assertCurrent()
  return result
}
