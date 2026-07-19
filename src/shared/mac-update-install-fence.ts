export const MAC_UPDATE_FENCE_SCHEMA_VERSION = 1
export const MAC_UPDATE_FENCE_BUNDLE_IDENTIFIER = 'com.stablyai.orca'
export const MAC_UPDATE_FENCE_MAX_BYTES = 32 * 1024
export const MAC_UPDATE_FENCE_FRESH_LEASE_MS = 15_000
export const MAC_UPDATE_FENCE_RECOVERY_GRACE_MS = 2_000
export const MAC_UPDATE_FENCE_ABSOLUTE_LIFETIME_MS = 30 * 60_000
export const MAC_UPDATE_FENCE_SHIPIT_APPEARANCE_MS = 120_000
export const MAC_UPDATE_FENCE_SHIPIT_EXIT_CONFIRMATION_MS = 15_000
// Why: an aborted ShipIt leaves a current ShipItState.plist behind, and launchd
// respawns a resumable install within ~1s; sustained absence past this bound
// means the install died. Treating a current plist as indefinite install
// evidence turned every aborted install into a full-lifetime launch blackout.
export const MAC_UPDATE_FENCE_SHIPIT_ABORT_CONFIRMATION_MS = 90_000
export const MAC_UPDATE_FENCE_HEARTBEAT_MS = 1_000

const CLOCK_SKEW_TOLERANCE_MS = 5_000
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const VERSION_PATTERN =
  /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

export type MacUpdateFencePhase = 'armed' | 'awaiting-shipit' | 'installing'

export type MacUpdateInstallFence = {
  schemaVersion: 1
  attemptId: string
  bundleIdentifier: string
  sourceVersion: string
  targetVersion: string
  targetBundlePath: string
  shipItStatePath: string
  sourcePid: number
  monitorPid: number
  phase: MacUpdateFencePhase
  createdAt: number
  heartbeatAt: number
  lastTransitionAt: number
  shipItSeenAt?: number
  absoluteExpiresAt: number
}

export type MacUpdateFenceParseFailure = 'malformed' | 'unknown_schema'

export type MacUpdateFenceParseResult =
  | { ok: true; fence: MacUpdateInstallFence }
  | { ok: false; reason: MacUpdateFenceParseFailure }

export type MacUpdateFenceDecisionReason =
  | 'different_target'
  | 'target_installed'
  | 'superseded'
  | 'incomparable_version'
  | 'active_install'
  | 'lease_recovered'
  | 'monitor_alive'
  | 'shipit_alive'
  | 'stale_lease'
  | 'absolute_timeout'

export type MacUpdateFenceDecision =
  | {
      kind: 'block'
      action: 'none'
      reason: Extract<
        MacUpdateFenceDecisionReason,
        'active_install' | 'lease_recovered' | 'monitor_alive' | 'shipit_alive'
      >
    }
  | {
      kind: 'start'
      action: 'none' | 'remove'
      reason: Exclude<
        MacUpdateFenceDecisionReason,
        'active_install' | 'lease_recovered' | 'monitor_alive' | 'shipit_alive'
      >
    }

export type MacUpdateFenceDecisionInput = {
  fence: MacUpdateInstallFence
  now: number
  currentVersion: string
  currentBundlePath: string
  leaseAdvancedDuringGrace?: boolean
  monitorIdentityAlive?: boolean
  matchingShipItAlive?: boolean
}

type ParsedVersion = {
  core: [number, number, number]
  prerelease: string[]
}

export function parseMacUpdateInstallFence(
  contents: string,
  now = Date.now()
): MacUpdateFenceParseResult {
  if (new TextEncoder().encode(contents).byteLength > MAC_UPDATE_FENCE_MAX_BYTES) {
    return { ok: false, reason: 'malformed' }
  }

  let value: unknown
  try {
    value = JSON.parse(contents)
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (!isRecord(value)) {
    return { ok: false, reason: 'malformed' }
  }
  if (value.schemaVersion !== MAC_UPDATE_FENCE_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: Number.isInteger(value.schemaVersion) ? 'unknown_schema' : 'malformed'
    }
  }

  const phase = value.phase
  const timestamps = [
    value.createdAt,
    value.heartbeatAt,
    value.lastTransitionAt,
    value.absoluteExpiresAt
  ]
  if (
    !isBoundedString(value.attemptId, 64) ||
    !UUID_PATTERN.test(value.attemptId) ||
    !isBoundedString(value.bundleIdentifier, 255) ||
    !isVersion(value.sourceVersion) ||
    !isVersion(value.targetVersion) ||
    !isAbsoluteMacPath(value.targetBundlePath) ||
    !value.targetBundlePath.toLowerCase().endsWith('.app') ||
    !isAbsoluteMacPath(value.shipItStatePath) ||
    !value.shipItStatePath.endsWith('ShipItState.plist') ||
    !isPid(value.sourcePid) ||
    !isPid(value.monitorPid) ||
    (phase !== 'armed' && phase !== 'awaiting-shipit' && phase !== 'installing') ||
    !timestamps.every(isEpochMilliseconds)
  ) {
    return { ok: false, reason: 'malformed' }
  }

  const rawCreatedAt = value.createdAt as number
  const rawAbsoluteExpiresAt = value.absoluteExpiresAt as number
  const rawShipItSeenAt = value.shipItSeenAt
  if (
    rawAbsoluteExpiresAt <= rawCreatedAt ||
    rawAbsoluteExpiresAt > rawCreatedAt + MAC_UPDATE_FENCE_ABSOLUTE_LIFETIME_MS ||
    (rawShipItSeenAt !== undefined && !isEpochMilliseconds(rawShipItSeenAt))
  ) {
    return { ok: false, reason: 'malformed' }
  }

  // Why: a wall-clock step back during an install legitimately leaves every
  // timestamp "in the future" (and new heartbeats below createdAt). Rejecting
  // that as malformed deletes the fence mid-install; clamping keeps the fence
  // usable while the recomputed expiry still bounds blocking to the lifetime.
  const clampFuture = (timestamp: number): number =>
    Math.min(timestamp, now + CLOCK_SKEW_TOLERANCE_MS)
  const createdAt = clampFuture(rawCreatedAt)
  const heartbeatAt = clampFuture(value.heartbeatAt as number)
  const lastTransitionAt = clampFuture(value.lastTransitionAt as number)
  const absoluteExpiresAt = Math.min(
    rawAbsoluteExpiresAt,
    createdAt + MAC_UPDATE_FENCE_ABSOLUTE_LIFETIME_MS
  )
  const shipItSeenAt =
    typeof rawShipItSeenAt === 'number' ? clampFuture(rawShipItSeenAt) : undefined

  return {
    ok: true,
    fence: {
      schemaVersion: MAC_UPDATE_FENCE_SCHEMA_VERSION,
      attemptId: value.attemptId,
      bundleIdentifier: value.bundleIdentifier,
      sourceVersion: value.sourceVersion,
      targetVersion: value.targetVersion,
      targetBundlePath: value.targetBundlePath,
      shipItStatePath: value.shipItStatePath,
      sourcePid: value.sourcePid,
      monitorPid: value.monitorPid,
      phase,
      createdAt,
      heartbeatAt,
      lastTransitionAt,
      ...(typeof shipItSeenAt === 'number' ? { shipItSeenAt } : {}),
      absoluteExpiresAt
    }
  }
}

export function decideMacUpdateFenceStartup(
  input: MacUpdateFenceDecisionInput
): MacUpdateFenceDecision {
  const { fence } = input
  if (
    fence.bundleIdentifier !== MAC_UPDATE_FENCE_BUNDLE_IDENTIFIER ||
    !macPathsEqual(fence.targetBundlePath, input.currentBundlePath)
  ) {
    return { kind: 'start', action: 'none', reason: 'different_target' }
  }

  const currentVersion = parseVersion(input.currentVersion)
  const sourceVersion = parseVersion(fence.sourceVersion)
  const targetVersion = parseVersion(fence.targetVersion)
  if (!currentVersion || !sourceVersion || !targetVersion) {
    return { kind: 'start', action: 'remove', reason: 'incomparable_version' }
  }
  if (compareParsedVersions(currentVersion, targetVersion) === 0) {
    return { kind: 'start', action: 'remove', reason: 'target_installed' }
  }
  if (
    compareParsedVersions(currentVersion, sourceVersion) > 0 &&
    compareParsedVersions(currentVersion, targetVersion) > 0
  ) {
    return { kind: 'start', action: 'remove', reason: 'superseded' }
  }

  if (input.now >= fence.absoluteExpiresAt) {
    return input.matchingShipItAlive
      ? { kind: 'block', action: 'none', reason: 'shipit_alive' }
      : { kind: 'start', action: 'remove', reason: 'absolute_timeout' }
  }
  // Why heartbeatAt <= now: after a backward wall-clock step, parse clamps a
  // future heartbeat to now+skew, which would otherwise read "fresh" on every
  // evaluation and block launches for the full size of the step even with a
  // dead monitor. A future heartbeat is not proof of liveness — fall through
  // to the process probes, which a live monitor passes within one tick.
  if (
    fence.heartbeatAt <= input.now &&
    input.now - fence.heartbeatAt <= MAC_UPDATE_FENCE_FRESH_LEASE_MS
  ) {
    return { kind: 'block', action: 'none', reason: 'active_install' }
  }
  if (input.leaseAdvancedDuringGrace) {
    return { kind: 'block', action: 'none', reason: 'lease_recovered' }
  }
  if (input.monitorIdentityAlive) {
    return { kind: 'block', action: 'none', reason: 'monitor_alive' }
  }
  if (input.matchingShipItAlive) {
    return { kind: 'block', action: 'none', reason: 'shipit_alive' }
  }
  return { kind: 'start', action: 'remove', reason: 'stale_lease' }
}

// Why: a fence written with a targetVersion this parser rejects reads back as
// malformed everywhere, so writers must validate before creating one.
export function isMacUpdateFenceVersion(value: string): boolean {
  return isVersion(value)
}

export function macPathsEqual(left: string, right: string): boolean {
  return normalizeMacPathForComparison(left) === normalizeMacPathForComparison(right)
}

export function normalizeMacPathForComparison(value: string): string {
  const withoutFirmlink = value.replace(/^\/System\/Volumes\/Data(?=\/)/i, '')
  const collapsed = withoutFirmlink.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/'
  return collapsed.normalize('NFC').toLocaleLowerCase('en-US')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
}

function isAbsoluteMacPath(value: unknown): value is string {
  return (
    isBoundedString(value, 4096) &&
    value.startsWith('/') &&
    !value.includes('\0') &&
    !value.split('/').includes('..')
  )
}

function isPid(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0
}

function isEpochMilliseconds(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0
}

function isVersion(value: unknown): value is string {
  return isBoundedString(value, 128) && parseVersion(value) !== null
}

function parseVersion(value: string): ParsedVersion | null {
  const match = value.trim().replace(/^v/i, '').match(VERSION_PATTERN)
  if (!match) {
    return null
  }
  const core = [Number(match[1]), Number(match[2]), Number(match[3])] as [number, number, number]
  if (!core.every(Number.isSafeInteger)) {
    return null
  }
  return { core, prerelease: match[4]?.split('.') ?? [] }
}

function compareParsedVersions(left: ParsedVersion, right: ParsedVersion): number {
  for (let index = 0; index < left.core.length; index += 1) {
    if (left.core[index] !== right.core[index]) {
      return left.core[index] - right.core[index]
    }
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return left.prerelease.length === right.prerelease.length
      ? 0
      : left.prerelease.length === 0
        ? 1
        : -1
  }
  for (
    let index = 0;
    index < Math.max(left.prerelease.length, right.prerelease.length);
    index += 1
  ) {
    const comparison = compareVersionIdentifier(left.prerelease[index], right.prerelease[index])
    if (comparison !== 0) {
      return comparison
    }
  }
  return 0
}

function compareVersionIdentifier(left: string | undefined, right: string | undefined): number {
  if (left === undefined || right === undefined) {
    return left === right ? 0 : left === undefined ? -1 : 1
  }
  const leftNumeric = /^\d+$/.test(left)
  const rightNumeric = /^\d+$/.test(right)
  if (leftNumeric && rightNumeric) {
    return Number(left) - Number(right)
  }
  if (leftNumeric !== rightNumeric) {
    return leftNumeric ? -1 : 1
  }
  return left.localeCompare(right)
}
