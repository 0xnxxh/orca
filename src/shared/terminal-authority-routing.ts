import {
  SSH_TERMINAL_AUTHORITY_CONSUMER_CANCEL_METHOD,
  SSH_TERMINAL_AUTHORITY_CONSUMER_CHALLENGE_METHOD,
  SSH_TERMINAL_AUTHORITY_CONSUMER_GRANT_METHOD,
  SSH_TERMINAL_AUTHORITY_CONSUMER_RESOLVE_NAMESPACE_METHOD,
  SSH_TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_CHALLENGE_METHOD,
  SSH_TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_METHOD
} from './terminal-authority-consumer-methods'
import {
  TERMINAL_AUTHORITY_NAMESPACE_BOUNDARY_ACCEPT_METHOD,
  TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_ACK_METHOD
} from './terminal-session-authority-consumer-transport'

export const TERMINAL_AUTHORITY_REQUEST_METHODS = Object.freeze([
  'pty.spawn',
  'pty.attach',
  'pty.shutdown',
  'pty.shutdownExact',
  'pty.shutdownAuthorityExact',
  'pty.sendSignal',
  'pty.sendSignalExact',
  'pty.sendSignalAuthorityExact',
  'pty.getCwd',
  'pty.getInitialCwd',
  'pty.getSize',
  'pty.clearBuffer',
  'pty.clearBufferExact',
  'pty.clearBufferAuthorityExact',
  'pty.hasChildProcesses',
  'pty.getForegroundProcess',
  'pty.inspectProcess',
  'pty.getCapabilities',
  'pty.listProcesses',
  'pty.getDefaultShell',
  'pty.serialize',
  'pty.revive',
  'pty.getProfiles',
  'pty.closeStartupQueryAuthority',
  'pty.openClient',
  'pty.setDeliveryPaused',
  SSH_TERMINAL_AUTHORITY_CONSUMER_CHALLENGE_METHOD,
  SSH_TERMINAL_AUTHORITY_CONSUMER_GRANT_METHOD,
  SSH_TERMINAL_AUTHORITY_CONSUMER_CANCEL_METHOD,
  SSH_TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_CHALLENGE_METHOD,
  SSH_TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_METHOD,
  SSH_TERMINAL_AUTHORITY_CONSUMER_RESOLVE_NAMESPACE_METHOD,
  TERMINAL_AUTHORITY_NAMESPACE_BOUNDARY_ACCEPT_METHOD,
  TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_ACK_METHOD,
  // Authenticated pre-open legacy worker migration controls.
  'terminalAuthority.legacyPhysicalWorker.inspect',
  'terminalAuthority.legacyPhysicalWorker.migrate',
  'terminalAuthority.legacyPhysicalWorker.gcProtection',
  'terminalAuthority.legacyPhysicalWorker.migrationBarrier',
  'terminalAuthority.legacyPhysicalWorker.gc',
  'pty.cancelDelivery',
  'agent_hook.installPlugins',
  'agent_hook.installManagedHooks',
  'agent_hook.requestReplay'
] as const)

export const TERMINAL_AUTHORITY_NOTIFICATION_METHODS = Object.freeze([
  'pty.data',
  'pty.dataExact',
  'pty.dataAuthorityExact',
  'pty.resize',
  'pty.resizeExact',
  'pty.resizeAuthorityExact',
  'pty.setDeliveryPaused',
  'pty.ackData'
] as const)

export const TERMINAL_AUTHORITY_EVENT_METHODS = Object.freeze([
  'pty.data',
  'pty.exit',
  'pty.replay',
  'pty.restoreRequired',
  'pty.deliveryCanceled',
  'pty.recoveryComplete',
  'agent.hook'
] as const)

export type TerminalAuthorityRequestMethod = (typeof TERMINAL_AUTHORITY_REQUEST_METHODS)[number]
export type TerminalAuthorityNotificationMethod =
  (typeof TERMINAL_AUTHORITY_NOTIFICATION_METHODS)[number]
export type TerminalAuthorityEventMethod = (typeof TERMINAL_AUTHORITY_EVENT_METHODS)[number]

const eventMethods = new Set<string>(TERMINAL_AUTHORITY_EVENT_METHODS)

export function isTerminalAuthorityEventMethod(
  method: string
): method is TerminalAuthorityEventMethod {
  return eventMethods.has(method)
}
