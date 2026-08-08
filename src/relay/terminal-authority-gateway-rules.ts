import type { TerminalAuthorityRequestMethod } from '../shared/terminal-authority-routing'

export const RESPONSE_ORDERED_REQUESTS = new Set<TerminalAuthorityRequestMethod>([
  'pty.openClient',
  'pty.spawn',
  'pty.attach'
])
export const LEGACY_MUTATION_REQUESTS = new Set<TerminalAuthorityRequestMethod>([
  'pty.shutdown',
  'pty.sendSignal',
  'pty.clearBuffer'
])
export const EXACT_MUTATION_REQUESTS = new Set<TerminalAuthorityRequestMethod>([
  'pty.shutdownExact',
  'pty.sendSignalExact',
  'pty.clearBufferExact'
])
export const AUTHORITY_EXACT_MUTATION_REQUESTS = new Set<TerminalAuthorityRequestMethod>([
  'pty.shutdownAuthorityExact',
  'pty.sendSignalAuthorityExact',
  'pty.clearBufferAuthorityExact'
])
export const PREOPEN_MIGRATION_REQUESTS = new Set<TerminalAuthorityRequestMethod>([
  'terminalAuthority.legacyPhysicalWorker.inspect',
  'terminalAuthority.legacyPhysicalWorker.migrate',
  'terminalAuthority.legacyPhysicalWorker.gcProtection',
  'terminalAuthority.legacyPhysicalWorker.migrationBarrier',
  'terminalAuthority.legacyPhysicalWorker.gc'
])
export const LEGACY_MUTATION_NOTIFICATIONS = new Set<string>(['pty.data', 'pty.resize'])
export const EXACT_MUTATION_NOTIFICATIONS = new Set<string>(['pty.dataExact', 'pty.resizeExact'])
export const AUTHORITY_EXACT_MUTATION_NOTIFICATIONS = new Set<string>([
  'pty.dataAuthorityExact',
  'pty.resizeAuthorityExact'
])
