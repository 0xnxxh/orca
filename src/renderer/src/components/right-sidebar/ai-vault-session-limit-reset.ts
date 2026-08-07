import {
  AI_VAULT_SESSION_LIMITS,
  DEFAULT_AI_VAULT_SESSION_LIMIT,
  normalizeAiVaultSessionLimit,
  type AiVaultSessionLimit
} from './ai-vault-session-limit'

// Bump when a new forced history-depth reset ships: every stored profile below this
// revision is pulled back to the performance default once and told why.
export const AI_VAULT_SESSION_LIMIT_RESET_REVISION = 1

export type AiVaultSessionLimitResetState = {
  sessionLimit: AiVaultSessionLimit
  sessionLimitResetRevision: number
  sessionLimitNoticeAcknowledged: boolean
}

type AiVaultSessionLimitResetRecord = {
  sessionLimit?: unknown
  sessionLimitResetRevision?: unknown
  sessionLimitNoticeAcknowledged?: unknown
}

function appliedResetRevision(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

// Ordering lives in the option list, so a default change cannot desync this comparison.
function exceedsPerformanceDefault(limit: AiVaultSessionLimit): boolean {
  return (
    AI_VAULT_SESSION_LIMITS.indexOf(limit) >
    AI_VAULT_SESSION_LIMITS.indexOf(DEFAULT_AI_VAULT_SESSION_LIMIT)
  )
}

export function hasCurrentAiVaultSessionLimitReset(value: unknown): boolean {
  const record = value && typeof value === 'object' ? (value as AiVaultSessionLimitResetRecord) : {}
  return (
    appliedResetRevision(record.sessionLimitResetRevision) >= AI_VAULT_SESSION_LIMIT_RESET_REVISION
  )
}

export function createAppliedAiVaultSessionLimitReset(): AiVaultSessionLimitResetState {
  // Profiles that never stored a depth start at the default, so there is nothing to announce.
  return {
    sessionLimit: DEFAULT_AI_VAULT_SESSION_LIMIT,
    sessionLimitResetRevision: AI_VAULT_SESSION_LIMIT_RESET_REVISION,
    sessionLimitNoticeAcknowledged: true
  }
}

export function resolveAiVaultSessionLimitReset(
  record: AiVaultSessionLimitResetRecord
): AiVaultSessionLimitResetState {
  const storedLimit = normalizeAiVaultSessionLimit(record.sessionLimit)
  if (hasCurrentAiVaultSessionLimitReset(record)) {
    return {
      sessionLimit: storedLimit,
      sessionLimitResetRevision: appliedResetRevision(record.sessionLimitResetRevision),
      sessionLimitNoticeAcknowledged: record.sessionLimitNoticeAcknowledged === true
    }
  }
  const reset = exceedsPerformanceDefault(storedLimit)
  return {
    sessionLimit: reset ? DEFAULT_AI_VAULT_SESSION_LIMIT : storedLimit,
    sessionLimitResetRevision: AI_VAULT_SESSION_LIMIT_RESET_REVISION,
    // Why: nothing moved for profiles already at or below the default, so stay quiet.
    sessionLimitNoticeAcknowledged: !reset
  }
}
