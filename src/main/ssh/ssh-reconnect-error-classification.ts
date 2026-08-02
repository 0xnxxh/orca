import { isAuthError, isPassphraseError, isTransientError } from './ssh-connection-utils'

// Why: the system-SSH transport reports network failures as OpenSSH prose, not errno codes, so its
// probe timeouts and connect failures never match isTransientError's code table.
const NETWORK_LIKE_ERROR_FRAGMENTS = [
  'system ssh connection timed out',
  'timed out while waiting for handshake',
  'connection timed out',
  'operation timed out',
  'connection refused',
  'connection reset',
  'no route to host',
  'network is unreachable',
  'network is down',
  'host is down',
  'broken pipe',
  'temporary failure in name resolution',
  'name or service not known',
  'nodename nor servname',
  'could not resolve hostname',
  'kex_exchange_identification'
]

/**
 * Why a second classifier: connect() spends isTransientError on INITIAL_RETRY_ATTEMPTS, so widening
 * it would turn one 30s system-SSH timeout into ~160s of silence and five security-key touch
 * prompts. The reconnect ladder has its own backoff and give-up bound, so it can afford to treat a
 * network-shaped failure as recoverable. Auth stays permanent on both paths.
 */
export function isTransientReconnectError(err: Error): boolean {
  if (isAuthError(err) || isPassphraseError(err)) {
    return false
  }
  if (isTransientError(err)) {
    return true
  }
  const message = err.message.toLowerCase()
  return NETWORK_LIKE_ERROR_FRAGMENTS.some((fragment) => message.includes(fragment))
}
