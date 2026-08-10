import type { UsageDailyAggregate, UsageSession } from '../usage/usage-rollup-records'
import type { UsageEventAttribution } from '../usage/usage-event-attribution'

export type OpenCodeUsageProcessedDatabase = {
  path: string
  mtimeMs: number
  size: number
}

type OpenCodeUsageMetric = {
  estimatedCostUsd: number | null
}

export type OpenCodeUsageSession = UsageSession<OpenCodeUsageMetric>
export type OpenCodeUsageDailyAggregate = UsageDailyAggregate<OpenCodeUsageMetric>

export type OpenCodeUsagePersistedDatabase = OpenCodeUsageProcessedDatabase & {
  sessions: OpenCodeUsageSession[]
  dailyAggregates: OpenCodeUsageDailyAggregate[]
  /** Session IDs counted by this database for sibling-copy dedupe. */
  ownedSessionIds: string[]
  /** Whether this database skipped sessions owned by another database. */
  hasDeferredClaims: boolean
}

export type OpenCodeUsagePersistedState = {
  schemaVersion: number
  worktreeFingerprint: string | null
  processedDatabases: OpenCodeUsagePersistedDatabase[]
  sessions: OpenCodeUsageSession[]
  dailyAggregates: OpenCodeUsageDailyAggregate[]
  scanState: {
    enabled: boolean
    lastScanStartedAt: number | null
    lastScanCompletedAt: number | null
    lastScanError: string | null
  }
}

export type OpenCodeUsageParsedEvent = {
  sessionId: string
  timestamp: string
  model: string | null
  cwd: string | null
  estimatedCostUsd: number | null
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
  totalTokens: number
}

export type OpenCodeUsageAttributedEvent = OpenCodeUsageParsedEvent & UsageEventAttribution
