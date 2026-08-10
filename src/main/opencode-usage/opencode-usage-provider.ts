import type { UsageProvider } from '../usage/usage-provider-contract'
import { scanOpenCodeUsageDatabases } from './scanner'
import type {
  OpenCodeUsageDailyAggregate,
  OpenCodeUsagePersistedDatabase,
  OpenCodeUsageSession
} from './types'

// v3 reparses projections after cross-platform path attribution fixes.
export const OPENCODE_USAGE_SCHEMA_VERSION = 3

export const openCodeUsageProvider = {
  id: 'opencode',
  label: 'OpenCode',
  schemaVersion: OPENCODE_USAGE_SCHEMA_VERSION,
  scan: scanOpenCodeUsageDatabases
} satisfies UsageProvider<
  'processedDatabases',
  OpenCodeUsagePersistedDatabase,
  OpenCodeUsageSession,
  OpenCodeUsageDailyAggregate
>
