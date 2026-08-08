import type { SshLegacyMigrationInventoryInput } from './ssh-legacy-migration-inventory-types'

export const SSH_LEGACY_MIGRATION_INVENTORY_CAPACITY = Object.freeze({
  persistedConsumerRecoveries: 256,
  persistedPtyLeases: 4_096,
  localLayoutPanes: 8_192,
  remoteSnapshotPanes: 8_192,
  liveRelays: 256,
  rowsPerRelay: 4_096,
  totalInventoryRows: 4_096
})

export class SshLegacyMigrationInventoryCapacityError extends Error {
  readonly code = 'ssh_legacy_migration_inventory_capacity'

  constructor(field: string) {
    super(`SSH legacy migration inventory ${field} exceeds bounded capacity`)
    this.name = 'SshLegacyMigrationInventoryCapacityError'
  }
}

export function assertSshLegacyMigrationInventoryCapacity(
  input: SshLegacyMigrationInventoryInput
): void {
  assertArrayCapacity(
    input.persistedConsumerRecoveries,
    SSH_LEGACY_MIGRATION_INVENTORY_CAPACITY.persistedConsumerRecoveries,
    'persisted consumer recoveries'
  )
  assertArrayCapacity(
    input.persistedPtyLeases,
    SSH_LEGACY_MIGRATION_INVENTORY_CAPACITY.persistedPtyLeases,
    'persisted PTY leases'
  )
  assertArrayCapacity(
    input.localLayoutPanes,
    SSH_LEGACY_MIGRATION_INVENTORY_CAPACITY.localLayoutPanes,
    'local layout panes'
  )
  assertArrayCapacity(
    input.remoteSnapshotPanes,
    SSH_LEGACY_MIGRATION_INVENTORY_CAPACITY.remoteSnapshotPanes,
    'remote snapshot panes'
  )
  assertArrayCapacity(
    input.liveRelays,
    SSH_LEGACY_MIGRATION_INVENTORY_CAPACITY.liveRelays,
    'live relays'
  )

  let totalRows = 0
  for (const relay of input.liveRelays) {
    assertArrayCapacity(
      relay.rows,
      SSH_LEGACY_MIGRATION_INVENTORY_CAPACITY.rowsPerRelay,
      'rows per relay'
    )
    totalRows += relay.rows.length
    if (totalRows > SSH_LEGACY_MIGRATION_INVENTORY_CAPACITY.totalInventoryRows) {
      throw new SshLegacyMigrationInventoryCapacityError('total inventory rows')
    }
  }
}

function assertArrayCapacity(
  value: unknown,
  maximum: number,
  field: string
): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new SshLegacyMigrationInventoryCapacityError(field)
  }
}
