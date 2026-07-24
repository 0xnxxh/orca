import type {
  CodexConfigSyncStallReason,
  CodexConfigSyncStatus
} from '../../../../shared/codex-config-sync-types'

// Why: the stall reason stays machine-readable all the way to the component so
// the sentence is localized at the edge like every other Accounts warning.
export function getCodexConfigSyncWarning(
  status: CodexConfigSyncStatus | null | undefined
): CodexConfigSyncStallReason | null {
  return status && status.state === 'stalled' ? status.reason : null
}
