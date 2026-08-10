import type { UsageProvider } from '../usage/usage-provider-contract'
import { scanCodexUsageFiles } from './scanner'
import type { CodexUsageDailyAggregate, CodexUsagePersistedFile, CodexUsageSession } from './types'

// v6 reparses projections after cross-platform path attribution fixes.
export const CODEX_USAGE_SCHEMA_VERSION = 6

export const codexUsageProvider = {
  id: 'codex',
  label: 'Codex',
  schemaVersion: CODEX_USAGE_SCHEMA_VERSION,
  scan: scanCodexUsageFiles
} satisfies UsageProvider<
  'processedFiles',
  CodexUsagePersistedFile,
  CodexUsageSession,
  CodexUsageDailyAggregate
>
