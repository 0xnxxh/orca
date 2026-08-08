import { isRecord } from '../../shared/terminal-session-authority-identity'

export const SSH_LEGACY_MIGRATION_EVIDENCE_CAPACITY = Object.freeze({
  workspacePartitions: 64,
  folderWorkspacesPerPartition: 4_096,
  workspaceOwnersPerPartition: 8_192,
  tabsPerWorkspace: 256,
  layoutsPerPartition: 8_192,
  bindingsPerLayout: 64,
  layoutNodes: 127,
  totalLocalPanes: 8_192,
  remoteWorkspacePaths: 8_192,
  totalRemoteTabs: 8_192,
  totalRemotePanes: 8_192,
  workerRecoveries: 256,
  discoveredRelays: 256,
  rowsPerRelay: 4_096,
  totalRelayRows: 4_096,
  persistedPtyLeases: 4_096
})

export type SshLegacyMigrationEvidenceErrorCode =
  | 'ambiguity'
  | 'capacity'
  | 'malformed'
  | 'resolution'

export class SshLegacyMigrationEvidenceError extends Error {
  constructor(
    readonly code: SshLegacyMigrationEvidenceErrorCode,
    field: string
  ) {
    super(`SSH legacy migration evidence ${field} is ${errorDescription(code)}`)
    this.name = 'SshLegacyMigrationEvidenceError'
  }
}

export function assertSshLegacyArrayCapacity(
  value: unknown,
  maximum: number,
  field: string
): asserts value is readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new SshLegacyMigrationEvidenceError('capacity', field)
  }
}

export function boundedSshLegacyRecordEntries(
  value: unknown,
  maximum: number,
  field: string
): readonly (readonly [string, unknown])[] {
  if (!isRecord(value)) {
    throw new SshLegacyMigrationEvidenceError('malformed', field)
  }
  const entries = Object.entries(value)
  if (entries.length > maximum) {
    throw new SshLegacyMigrationEvidenceError('capacity', field)
  }
  return entries
}

export function failSshLegacyMigrationEvidence(
  code: SshLegacyMigrationEvidenceErrorCode,
  field: string
): never {
  throw new SshLegacyMigrationEvidenceError(code, field)
}

function errorDescription(code: SshLegacyMigrationEvidenceErrorCode): string {
  switch (code) {
    case 'ambiguity':
      return 'ambiguous'
    case 'capacity':
      return 'over capacity'
    case 'malformed':
      return 'malformed'
    case 'resolution':
      return 'unresolved on the authority host'
  }
}
