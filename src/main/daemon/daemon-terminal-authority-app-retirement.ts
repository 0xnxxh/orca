import type { TerminalAuthorityAppConsumerRetirementRequest } from '../session-authority/terminal-authority-app-outcome-host-contract'
import { retireTerminalAuthorityAppConsumer } from '../session-authority/terminal-authority-app-consumer-retirement'
import type { DaemonTerminalAuthorityAppHostTransportOptions } from './daemon-terminal-authority-app-host-transport'
import {
  DAEMON_TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_CHALLENGE_REQUEST,
  DAEMON_TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_REQUEST
} from './daemon-terminal-authority-consumer-requests'

export async function retireDaemonTerminalAuthorityAppConsumer(
  options: DaemonTerminalAuthorityAppHostTransportOptions,
  request: TerminalAuthorityAppConsumerRetirementRequest,
  assertCurrent: () => void
) {
  assertCurrent()
  if (!options.client.terminalSessionAuthorityConsumerRetirementSupported?.()) {
    throw new Error('daemon terminal authority consumer retirement is unsupported')
  }
  const result = await retireTerminalAuthorityAppConsumer({
    authenticatedAuthorityHostId: options.authenticatedAuthorityHostId,
    keypair: options.keypair,
    request,
    issueChallenge: (start) =>
      options.client.request(
        DAEMON_TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_CHALLENGE_REQUEST,
        start
      ),
    complete: (proof) =>
      options.client.request(DAEMON_TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_REQUEST, proof)
  })
  assertCurrent()
  return result
}
