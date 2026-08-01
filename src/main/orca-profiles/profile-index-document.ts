// Pure shaping/validation for the on-disk profile index. No fs here, so the
// sync bootstrap store and its async twins share one source of truth.
import { randomUUID } from 'node:crypto'
import {
  createDefaultLocalOrcaProfile,
  DEFAULT_LOCAL_ORCA_PROFILE_NAME,
  ORCA_PROFILE_INDEX_SCHEMA_VERSION,
  type CreateLocalOrcaProfileArgs,
  type OrcaProfileIndex,
  type OrcaProfileSummary
} from '../../shared/orca-profiles'

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isProfileSummary(value: unknown): value is OrcaProfileSummary {
  if (!isObject(value)) {
    return false
  }
  const avatar = value.avatar
  const cloud = value.cloud
  return (
    typeof value.id === 'string' &&
    // Why: IDs from the on-disk index become filesystem path segments; a
    // tampered index must not be able to escape the profiles directory.
    /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value.id) &&
    typeof value.name === 'string' &&
    value.name.length > 0 &&
    (value.kind === 'local' || value.kind === 'cloud-linked') &&
    typeof value.createdAt === 'number' &&
    typeof value.updatedAt === 'number' &&
    typeof value.lastOpenedAt === 'number' &&
    isObject(avatar) &&
    avatar.kind === 'initials' &&
    typeof avatar.initials === 'string' &&
    avatar.color === 'neutral' &&
    (cloud === undefined || isObject(cloud))
  )
}

export function normalizeProfileIndex(raw: unknown): OrcaProfileIndex | null {
  if (!isObject(raw) || !Array.isArray(raw.profiles)) {
    return null
  }
  const profiles = raw.profiles.filter(isProfileSummary)
  const activeProfileId =
    typeof raw.activeProfileId === 'string' &&
    profiles.some((profile) => profile.id === raw.activeProfileId)
      ? raw.activeProfileId
      : profiles[0]?.id
  if (!activeProfileId) {
    return null
  }
  return {
    schemaVersion: ORCA_PROFILE_INDEX_SCHEMA_VERSION,
    activeProfileId,
    profiles
  }
}

export function parseProfileIndexJson(contents: string): OrcaProfileIndex | null {
  try {
    return normalizeProfileIndex(JSON.parse(contents))
  } catch {
    return null
  }
}

export function serializeProfileIndex(index: OrcaProfileIndex): string {
  return JSON.stringify(index, null, 2)
}

function sanitizeProfileName(value: unknown): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed.length > 0 ? trimmed.slice(0, 80) : 'New Profile'
}

export function createInitialProfileIndex(now = Date.now()): OrcaProfileIndex {
  const profile = createDefaultLocalOrcaProfile(now)
  return {
    schemaVersion: ORCA_PROFILE_INDEX_SCHEMA_VERSION,
    activeProfileId: profile.id,
    profiles: [profile]
  }
}

export function getActiveProfile(index: OrcaProfileIndex): OrcaProfileSummary {
  return (
    index.profiles.find((profile) => profile.id === index.activeProfileId) ??
    index.profiles[0] ??
    createDefaultLocalOrcaProfile(Date.now())
  )
}

// Why: minted outside the index write so a retried write reuses the same id
// (and therefore the same profile directory) instead of orphaning one.
export function buildNewLocalProfile(
  args: CreateLocalOrcaProfileArgs,
  now = Date.now()
): OrcaProfileSummary {
  const name = sanitizeProfileName(args.name)
  return {
    id: `local-${randomUUID()}`,
    name,
    avatar: {
      kind: 'initials',
      initials: (
        name.match(/[A-Za-z0-9]/)?.[0] ?? DEFAULT_LOCAL_ORCA_PROFILE_NAME[0]
      ).toUpperCase(),
      color: 'neutral'
    },
    kind: 'local',
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now
  }
}

export function appendProfileToIndex(
  index: OrcaProfileIndex,
  profile: OrcaProfileSummary
): OrcaProfileIndex {
  return { ...index, profiles: [...index.profiles, profile] }
}

export function withActiveProfile(
  index: OrcaProfileIndex,
  profileId: string,
  now = Date.now()
): OrcaProfileIndex {
  let found = false
  const profiles = index.profiles.map((profile) => {
    if (profile.id !== profileId) {
      return profile
    }
    found = true
    return { ...profile, updatedAt: now, lastOpenedAt: now }
  })
  if (!found) {
    throw new Error('unknown_orca_profile')
  }
  return { ...index, activeProfileId: profileId, profiles }
}
