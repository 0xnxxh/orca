import type { UsageDailyAggregate, UsageSession } from '../usage/usage-rollup-records'
import type { UsageEventAttribution } from '../usage/usage-event-attribution'

export type CodexUsageProcessedFile = {
  path: string
  mtimeMs: number
  size: number
}

type CodexUsageMetric = {
  hasInferredPricing: boolean
}

export type CodexUsageSession = UsageSession<CodexUsageMetric>
export type CodexUsageDailyAggregate = UsageDailyAggregate<CodexUsageMetric>

export type CodexUsagePersistedFile = CodexUsageProcessedFile & {
  sessions: CodexUsageSession[]
  dailyAggregates: CodexUsageDailyAggregate[]
  /** Event keys counted by this file for copied-record dedupe. */
  ownedEventKeys: string[]
  /** Whether this file skipped events owned by another file. */
  hasDeferredClaims: boolean
}

export type CodexUsagePersistedState = {
  schemaVersion: number
  worktreeFingerprint: string | null
  processedFiles: CodexUsagePersistedFile[]
  sessions: CodexUsageSession[]
  dailyAggregates: CodexUsageDailyAggregate[]
  scanState: {
    enabled: boolean
    lastScanStartedAt: number | null
    lastScanCompletedAt: number | null
    lastScanError: string | null
  }
}

export type CodexUsageParsedEvent = {
  sessionId: string
  timestamp: string
  /** Raw token-record identity; excludes session ID because forks rewrite it. */
  eventKey: string
  model: string | null
  cwd: string | null
  hasInferredPricing: boolean
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
  totalTokens: number
}

export type CodexUsageAttributedEvent = CodexUsageParsedEvent & UsageEventAttribution
