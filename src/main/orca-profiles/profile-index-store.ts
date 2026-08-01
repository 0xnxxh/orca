// Sync bootstrap for the profile index. These run before there is a window to
// block (src/main/index.ts) or from callers that cannot await. IPC handlers must
// use the async twins in `profile-index-async-store.ts` instead — a sync fs call
// on a stalled network mount freezes the whole app.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { dirname } from 'node:path'
import type { GlobalSettings } from '../../shared/types'
import {
  DEFAULT_LOCAL_ORCA_PROFILE_ID,
  type CreateLocalOrcaProfileArgs,
  type CreateLocalOrcaProfileResult,
  type OrcaProfileIndex,
  type OrcaProfileListState,
  type OrcaProfileSummary
} from '../../shared/orca-profiles'
import {
  appendProfileToIndex,
  buildNewLocalProfile,
  createInitialProfileIndex,
  getActiveProfile,
  parseProfileIndexJson,
  serializeProfileIndex,
  withActiveProfile
} from './profile-index-document'
import {
  cacheProfileIndex,
  claimInFlightAsyncIndexTmpPath,
  recordSyncProfileIndexWrite
} from './profile-index-async-store'
import {
  getOrcaProfileBrowserSessionMetaFile,
  getOrcaProfileDataFile,
  getOrcaProfileDirectory,
  getOrcaProfileIndexPath,
  getProfileUserDataPath,
  LEGACY_BACKUP_COUNT,
  legacyBackupPath,
  legacyBrowserSessionMetaPath,
  legacyDataFilePath,
  profileBackupPath
} from './profile-storage-paths'

export {
  getOrcaProfileBrowserSessionMetaFile,
  getOrcaProfileDataFile,
  getOrcaProfileDirectory,
  getOrcaProfileIndexPath,
  getOrcaProfilesDirectory,
  initOrcaProfilePaths
} from './profile-storage-paths'

export {
  createLocalOrcaProfileAsync,
  ensureActiveOrcaProfileAsync,
  getOrcaProfileListStateAsync,
  readProfileIndexAsync,
  seedNewOrcaProfileTelemetryConsentAsync,
  setActiveOrcaProfileAsync
} from './profile-index-async-store'

export type ActiveOrcaProfileState = {
  index: OrcaProfileIndex
  profile: OrcaProfileSummary
  dataFile: string
  profileDirectory: string
}

function readProfileIndexFile(indexPath: string): OrcaProfileIndex | null {
  try {
    return parseProfileIndexJson(readFileSync(indexPath, 'utf-8'))
  } catch {
    return null
  }
}

export function readProfileIndex(indexPath: string): OrcaProfileIndex | null {
  // Why: a torn/corrupt index must not silently reset the app to a single
  // default profile — that would orphan every other profile's data directory.
  return readProfileIndexFile(indexPath) ?? readProfileIndexFile(`${indexPath}.bak`)
}

export function writeProfileIndex(indexPath: string, index: OrcaProfileIndex): void {
  // Veto an async write already parked on `rename`: no guard can stop that
  // rename, but deleting the temp file it is renaming makes it fail with
  // ENOENT, so this write is not silently clobbered by the async twin.
  const asyncTmpPath = claimInFlightAsyncIndexTmpPath(indexPath)
  if (asyncTmpPath) {
    try {
      unlinkSync(asyncTmpPath)
    } catch {
      // Already renamed or never created; the async writer re-reads either way.
    }
  }
  mkdirSync(dirname(indexPath), { recursive: true })
  // Why: only a still-parseable current index may refresh the backup;
  // copying a corrupt file over the backup would destroy the recovery copy.
  if (existsSync(indexPath) && readProfileIndexFile(indexPath)) {
    try {
      copyFileSync(indexPath, `${indexPath}.bak`)
    } catch {
      // Best-effort backup; the primary write below still proceeds.
    }
  }
  const tmpPath = `${indexPath}.tmp`
  writeFileSync(tmpPath, serializeProfileIndex(index), 'utf-8')
  renameSync(tmpPath, indexPath)
  // Why: keeps the zero-fs list cache correct and lets an async read-modify-write
  // detect that a sync writer landed underneath it.
  recordSyncProfileIndexWrite(indexPath, index)
}

function copyIfPresent(source: string, target: string): void {
  if (!existsSync(source) || existsSync(target)) {
    return
  }
  mkdirSync(dirname(target), { recursive: true })
  // Why: tmp+rename so a crash mid-copy cannot leave a truncated target that
  // the exists() guard above would then treat as a completed migration.
  const tmpTarget = `${target}.tmp`
  copyFileSync(source, tmpTarget)
  renameSync(tmpTarget, target)
}

function copyLegacyStateToProfile(userDataPath: string, profileId: string): void {
  const profileDataFile = getOrcaProfileDataFile(profileId, userDataPath)
  copyIfPresent(legacyDataFilePath(userDataPath), profileDataFile)
  copyIfPresent(
    legacyBrowserSessionMetaPath(userDataPath),
    getOrcaProfileBrowserSessionMetaFile(profileId, userDataPath)
  )
  for (let i = 0; i < LEGACY_BACKUP_COUNT; i++) {
    copyIfPresent(legacyBackupPath(userDataPath, i), profileBackupPath(profileDataFile, i))
  }
}

// Why: a brand-new profile has no data file, which the telemetry cohort
// migration reads as a fresh install and defaults to opted-in. Copying the
// active profile's consent block keeps an opted-out user opted out (and keeps
// one installId per install) when they create additional profiles.
export function seedNewOrcaProfileTelemetryConsent(
  profileId: string,
  telemetry: GlobalSettings['telemetry'],
  userDataPath = getProfileUserDataPath()
): void {
  if (!telemetry) {
    return
  }
  const dataFile = getOrcaProfileDataFile(profileId, userDataPath)
  if (existsSync(dataFile)) {
    return
  }
  mkdirSync(dirname(dataFile), { recursive: true })
  const tmpPath = `${dataFile}.tmp`
  writeFileSync(tmpPath, JSON.stringify({ settings: { telemetry } }, null, 2), 'utf-8')
  renameSync(tmpPath, dataFile)
}

export function loadOrCreateProfileIndex(userDataPath: string): OrcaProfileIndex {
  const indexPath = getOrcaProfileIndexPath(userDataPath)
  const index = existsSync(indexPath) ? readProfileIndex(indexPath) : null
  if (index) {
    return index
  }
  const nextIndex = createInitialProfileIndex()
  writeProfileIndex(indexPath, nextIndex)
  return nextIndex
}

export function ensureActiveOrcaProfile(
  userDataPath = getProfileUserDataPath()
): ActiveOrcaProfileState {
  const indexPath = getOrcaProfileIndexPath(userDataPath)
  let index = existsSync(indexPath) ? readProfileIndex(indexPath) : null
  let shouldWriteIndex = false

  if (!index) {
    index = createInitialProfileIndex()
    shouldWriteIndex = true
  }

  const activeProfile = getActiveProfile(index)
  if (activeProfile.id !== index.activeProfileId) {
    index = { ...index, activeProfileId: activeProfile.id }
    shouldWriteIndex = true
  }

  const profileDirectory = getOrcaProfileDirectory(activeProfile.id, userDataPath)
  mkdirSync(profileDirectory, { recursive: true })
  if (activeProfile.id === DEFAULT_LOCAL_ORCA_PROFILE_ID) {
    copyLegacyStateToProfile(userDataPath, activeProfile.id)
  }

  if (shouldWriteIndex) {
    writeProfileIndex(indexPath, index)
  } else {
    // Why: boot resolves the index here; caching it lets orcaProfiles:list
    // answer the startup chain without touching the filesystem at all.
    cacheProfileIndex(indexPath, index)
  }

  return {
    index,
    profile: activeProfile,
    dataFile: getOrcaProfileDataFile(activeProfile.id, userDataPath),
    profileDirectory
  }
}

export function isDefaultLocalOrcaProfileId(profileId: string): boolean {
  return profileId === DEFAULT_LOCAL_ORCA_PROFILE_ID
}

export function getOrcaProfileListState(
  userDataPath = getProfileUserDataPath()
): OrcaProfileListState {
  const { index } = ensureActiveOrcaProfile(userDataPath)
  return {
    activeProfileId: index.activeProfileId,
    profiles: index.profiles
  }
}

export function createLocalOrcaProfile(
  args: CreateLocalOrcaProfileArgs = {},
  userDataPath = getProfileUserDataPath()
): CreateLocalOrcaProfileResult {
  const index = loadOrCreateProfileIndex(userDataPath)
  const profile = buildNewLocalProfile(args)
  const nextIndex = appendProfileToIndex(index, profile)
  mkdirSync(getOrcaProfileDirectory(profile.id, userDataPath), { recursive: true })
  writeProfileIndex(getOrcaProfileIndexPath(userDataPath), nextIndex)
  return {
    activeProfileId: nextIndex.activeProfileId,
    profiles: nextIndex.profiles,
    profile
  }
}

export function setActiveOrcaProfile(
  profileId: string,
  userDataPath = getProfileUserDataPath()
): OrcaProfileListState {
  const index = loadOrCreateProfileIndex(userDataPath)
  const nextIndex = withActiveProfile(index, profileId)
  mkdirSync(getOrcaProfileDirectory(profileId, userDataPath), { recursive: true })
  writeProfileIndex(getOrcaProfileIndexPath(userDataPath), nextIndex)
  return {
    activeProfileId: nextIndex.activeProfileId,
    profiles: nextIndex.profiles
  }
}
