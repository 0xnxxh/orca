import type { GitUpstreamStatus } from '../../../shared/types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function isOptionalBoolean(value: Record<string, unknown>, key: string): boolean {
  return !hasOwn(value, key) || typeof value[key] === 'boolean'
}

export function readGitRepositorySnapshotUpstream(value: unknown): GitUpstreamStatus | null {
  if (
    !isRecord(value) ||
    typeof value.hasUpstream !== 'boolean' ||
    typeof value.ahead !== 'number' ||
    !Number.isSafeInteger(value.ahead) ||
    value.ahead < 0 ||
    typeof value.behind !== 'number' ||
    !Number.isSafeInteger(value.behind) ||
    value.behind < 0
  ) {
    return null
  }
  const hasUpstreamName = hasOwn(value, 'upstreamName')
  const hasConfiguredPushTarget = hasOwn(value, 'hasConfiguredPushTarget')
  const hasPatchEquivalence = hasOwn(value, 'behindCommitsArePatchEquivalent')
  if (
    (hasUpstreamName && typeof value.upstreamName !== 'string') ||
    !isOptionalBoolean(value, 'hasConfiguredPushTarget') ||
    !isOptionalBoolean(value, 'behindCommitsArePatchEquivalent')
  ) {
    return null
  }
  if (value.hasUpstream) {
    if (typeof value.upstreamName !== 'string' || value.upstreamName.trim().length === 0) {
      return null
    }
  } else if (
    value.ahead !== 0 ||
    value.behind !== 0 ||
    hasUpstreamName ||
    hasPatchEquivalence ||
    (hasConfiguredPushTarget && value.hasConfiguredPushTarget !== true)
  ) {
    return null
  }
  if (value.ahead > 0 && value.behind > 0 && !hasPatchEquivalence) {
    return null
  }
  return { ...value } as GitUpstreamStatus
}
