export const DEVICE_REGISTRY_FILENAME = 'orca-devices.json'
export const E2EE_KEYPAIR_FILENAME = 'orca-e2ee-keypair.json'
// Why: this marker distinguishes a deleted established identity from a fresh install without storing another key.
export const E2EE_IDENTITY_MARKER_FILENAME = 'terminal-authority-consumer-proof-identity.json'
// Why: one deterministic private stage lets startup finish the exact publication that was interrupted.
export const E2EE_KEYPAIR_STAGE_FILENAME = `${E2EE_KEYPAIR_FILENAME}.stage`
// Why: Windows cannot replace an open destination; this bounded rollback artifact makes the rename boundary restartable.
export const E2EE_KEYPAIR_BACKUP_FILENAME = `.${E2EE_KEYPAIR_FILENAME}.backup`
export const RELAY_REVOKE_OUTBOX_FILENAME = 'mobile-relay-revoke-outbox.json'
// Why: one bounded crash-resumable identity reset record owns the only
// transaction that may replace the established proof identity.
export const E2EE_IDENTITY_RESET_FILENAME = 'orca-e2ee-identity-reset.json'

// Required pairing files migrate together; marker, stage, and rollback follow when present.
export const MOBILE_PAIRING_USERDATA_FILES = [
  DEVICE_REGISTRY_FILENAME,
  E2EE_KEYPAIR_FILENAME,
  E2EE_IDENTITY_MARKER_FILENAME,
  E2EE_KEYPAIR_STAGE_FILENAME,
  E2EE_KEYPAIR_BACKUP_FILENAME,
  RELAY_REVOKE_OUTBOX_FILENAME
] as const
