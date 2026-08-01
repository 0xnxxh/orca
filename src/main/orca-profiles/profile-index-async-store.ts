// Async twins of the profile index store, for IPC handlers that run after the
// window exists. The sync bootstrap in `profile-index-store.ts` stays — it runs
// before there is a renderer to block. Everything here keeps the Electron main
// thread out of `mkdir`/`copyFile`/`rename` syscalls, which enter an
// uninterruptible wait when the userData path lives on a stalled network mount.
import { access, copyFile, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { GlobalSettings } from '../../shared/types'
import {
  DEFAULT_LOCAL_ORCA_PROFILE_ID,
  type CreateLocalOrcaProfileArgs,
  type CreateLocalOrcaProfileResult,
  type OrcaProfileIndex,
  type OrcaProfileListState
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
import type { ActiveOrcaProfileState } from './profile-index-store'

// Why: `orcaProfiles:list` sits on the app-startup chain. Boot already resolved
// the index, so cache it and let the handler answer with zero fs syscalls.
const cachedIndexByPath = new Map<string, OrcaProfileIndex>()

// Why: async writes lose the single-thread serialization the sync store got for
// free. Sync writers still exist (startup, cloud index); count their writes so
// an async read-modify-write that raced one retries instead of clobbering it.
// Keyed by index path: a global counter would let a write to one index falsely
// veto an in-flight write to another, and three false vetoes throw.
const syncWriteEpochs = new Map<string, number>()
const MAX_INDEX_WRITE_ATTEMPTS = 3

function syncWriteEpochFor(indexPath: string): number {
  return syncWriteEpochs.get(indexPath) ?? 0
}

// Why: distinct from the sync store's `.tmp` so an interleaved sync write can
// never rename a half-written async temp file over a good index.
const ASYNC_TMP_SUFFIX = '.async.tmp'

// Staged temp file of the async write currently parked on `rename`, per index
// path. An epoch check cannot stop that rename — it is already in flight — so
// the sync twin deletes this file instead and the rename fails with ENOENT.
const inFlightAsyncTmpFiles = new Map<string, string>()

export function cacheProfileIndex(indexPath: string, index: OrcaProfileIndex): void {
  cachedIndexByPath.set(indexPath, index)
}

/** Veto handshake: the sync writer takes the staged temp path and unlinks it. */
export function claimInFlightAsyncIndexTmpPath(indexPath: string): string | null {
  const tmpPath = inFlightAsyncTmpFiles.get(indexPath)
  inFlightAsyncTmpFiles.delete(indexPath)
  return tmpPath ?? null
}

export function recordSyncProfileIndexWrite(indexPath: string, index: OrcaProfileIndex): void {
  syncWriteEpochs.set(indexPath, syncWriteEpochFor(indexPath) + 1)
  cachedIndexByPath.set(indexPath, index)
}

// Single-flight per index path: two overlapping writes can never rename out of
// order, and a read-modify-write can hold the lane across its read.
const writeChains = new Map<string, Promise<void>>()

function runExclusive<T>(indexPath: string, task: () => Promise<T>): Promise<T> {
  const chain = (writeChains.get(indexPath) ?? Promise.resolve()).then(task, task)
  const settled = chain.then(
    () => undefined,
    () => undefined
  )
  writeChains.set(indexPath, settled)
  void settled.then(() => {
    if (writeChains.get(indexPath) === settled) {
      writeChains.delete(indexPath)
    }
  })
  return chain
}

async function readProfileIndexFileAsync(indexPath: string): Promise<OrcaProfileIndex | null> {
  try {
    return parseProfileIndexJson(await readFile(indexPath, 'utf-8'))
  } catch {
    return null
  }
}

export async function readProfileIndexAsync(indexPath: string): Promise<OrcaProfileIndex | null> {
  // Why: a torn/corrupt index must not silently reset the app to a single
  // default profile — that would orphan every other profile's data directory.
  return (
    (await readProfileIndexFileAsync(indexPath)) ??
    (await readProfileIndexFileAsync(`${indexPath}.bak`))
  )
}

/** Resolves false when a sync writer won the file; the caller must rebuild. */
async function writeProfileIndexFile(indexPath: string, index: OrcaProfileIndex): Promise<boolean> {
  const epoch = syncWriteEpochFor(indexPath)
  await mkdir(dirname(indexPath), { recursive: true })
  // Why: only a still-parseable current index may refresh the backup; copying a
  // corrupt file over the backup would destroy the recovery copy. The read
  // doubles as the existence probe, so there is no separate exists() syscall.
  if (await readProfileIndexFileAsync(indexPath)) {
    await copyFile(indexPath, `${indexPath}.bak`).catch(() => {
      // Best-effort backup; the primary write below still proceeds.
    })
  }
  const tmpPath = `${indexPath}${ASYNC_TMP_SUFFIX}`
  await writeFile(tmpPath, serializeProfileIndex(index), 'utf-8')
  if (syncWriteEpochFor(indexPath) !== epoch) {
    // A sync writer committed while the temp file was staged. Checking in the
    // same turn that issues the rename is what makes this guard meaningful.
    await unlink(tmpPath).catch(() => {})
    return false
  }
  inFlightAsyncTmpFiles.set(indexPath, tmpPath)
  try {
    await rename(tmpPath, indexPath)
  } catch (error) {
    // ENOENT is the veto: a sync writer deleted the temp file out from under
    // the parked rename. Anything else is a real failure.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false
    }
    await unlink(tmpPath).catch(() => {})
    throw error
  } finally {
    if (inFlightAsyncTmpFiles.get(indexPath) === tmpPath) {
      inFlightAsyncTmpFiles.delete(indexPath)
    }
  }
  if (syncWriteEpochFor(indexPath) !== epoch) {
    // The rename beat the veto but a sync write landed on top of it. Leave that
    // writer's cache entry alone instead of publishing this stale index.
    return false
  }
  cachedIndexByPath.set(indexPath, index)
  return true
}

async function loadOrCreateIndex(indexPath: string): Promise<OrcaProfileIndex> {
  const index = await readProfileIndexAsync(indexPath)
  if (index) {
    return index
  }
  const nextIndex = createInitialProfileIndex()
  // A vetoed seed write is handled by the caller's retry, which re-reads.
  await writeProfileIndexFile(indexPath, nextIndex)
  return nextIndex
}

async function mutateProfileIndexAsync(
  userDataPath: string,
  mutate: (index: OrcaProfileIndex) => OrcaProfileIndex | Promise<OrcaProfileIndex>
): Promise<OrcaProfileIndex> {
  const indexPath = getOrcaProfileIndexPath(userDataPath)
  return runExclusive(indexPath, async () => {
    for (let attempt = 1; attempt <= MAX_INDEX_WRITE_ATTEMPTS; attempt++) {
      const epoch = syncWriteEpochFor(indexPath)
      const next = await mutate(await loadOrCreateIndex(indexPath))
      // Re-read when a sync writer landed mid-mutation so its update survives.
      if (
        syncWriteEpochFor(indexPath) === epoch &&
        (await writeProfileIndexFile(indexPath, next))
      ) {
        return next
      }
    }
    // Why throw instead of force-writing: reporting a mutation that a sync
    // writer overwrote is worse than surfacing the failure to the caller.
    throw new Error('orca_profile_index_write_lost_to_concurrent_sync_write')
  })
}

async function copyIfPresentAsync(source: string, target: string): Promise<void> {
  try {
    await access(target)
    return
  } catch {
    // Not migrated yet.
  }
  const tmpTarget = `${target}${ASYNC_TMP_SUFFIX}`
  try {
    await mkdir(dirname(target), { recursive: true })
    // Why: tmp+rename so a crash mid-copy cannot leave a truncated target that
    // the access() guard above would then treat as a completed migration. A
    // missing source surfaces as ENOENT here instead of a second probe.
    await copyFile(source, tmpTarget)
    await rename(tmpTarget, target)
  } catch {
    await unlink(tmpTarget).catch(() => {})
  }
}

async function copyLegacyStateToProfileAsync(
  userDataPath: string,
  profileId: string
): Promise<void> {
  const profileDataFile = getOrcaProfileDataFile(profileId, userDataPath)
  await copyIfPresentAsync(legacyDataFilePath(userDataPath), profileDataFile)
  await copyIfPresentAsync(
    legacyBrowserSessionMetaPath(userDataPath),
    getOrcaProfileBrowserSessionMetaFile(profileId, userDataPath)
  )
  for (let i = 0; i < LEGACY_BACKUP_COUNT; i++) {
    await copyIfPresentAsync(
      legacyBackupPath(userDataPath, i),
      profileBackupPath(profileDataFile, i)
    )
  }
}

/** Resolves null when a sync writer replaced the index mid-flight. */
async function resolveActiveProfileOnce(
  indexPath: string,
  userDataPath: string
): Promise<ActiveOrcaProfileState | null> {
  const epoch = syncWriteEpochFor(indexPath)
  const fromDisk = await readProfileIndexAsync(indexPath)
  let index = fromDisk ?? createInitialProfileIndex()
  let shouldWriteIndex = fromDisk === null

  const activeProfile = getActiveProfile(index)
  if (activeProfile.id !== index.activeProfileId) {
    index = { ...index, activeProfileId: activeProfile.id }
    shouldWriteIndex = true
  }

  const profileDirectory = getOrcaProfileDirectory(activeProfile.id, userDataPath)
  await mkdir(profileDirectory, { recursive: true })
  if (activeProfile.id === DEFAULT_LOCAL_ORCA_PROFILE_ID) {
    await copyLegacyStateToProfileAsync(userDataPath, activeProfile.id)
  }

  if (shouldWriteIndex) {
    if (!(await writeProfileIndexFile(indexPath, index))) {
      return null
    }
  } else if (syncWriteEpochFor(indexPath) !== epoch) {
    // The awaits above let a sync writer commit a newer index; publishing this
    // one would poison the zero-fs list cache with a stale profile set.
    return null
  } else {
    cachedIndexByPath.set(indexPath, index)
  }

  return {
    index,
    profile: activeProfile,
    dataFile: getOrcaProfileDataFile(activeProfile.id, userDataPath),
    profileDirectory
  }
}

export function ensureActiveOrcaProfileAsync(
  userDataPath = getProfileUserDataPath()
): Promise<ActiveOrcaProfileState> {
  const indexPath = getOrcaProfileIndexPath(userDataPath)
  return runExclusive(indexPath, async () => {
    for (let attempt = 1; attempt <= MAX_INDEX_WRITE_ATTEMPTS; attempt++) {
      const resolved = await resolveActiveProfileOnce(indexPath, userDataPath)
      if (resolved) {
        return resolved
      }
    }
    throw new Error('orca_profile_index_write_lost_to_concurrent_sync_write')
  })
}

export async function getOrcaProfileListStateAsync(
  userDataPath = getProfileUserDataPath()
): Promise<OrcaProfileListState> {
  const cached = cachedIndexByPath.get(getOrcaProfileIndexPath(userDataPath))
  const index = cached ?? (await ensureActiveOrcaProfileAsync(userDataPath)).index
  return { activeProfileId: index.activeProfileId, profiles: index.profiles }
}

export async function createLocalOrcaProfileAsync(
  args: CreateLocalOrcaProfileArgs = {},
  userDataPath = getProfileUserDataPath()
): Promise<CreateLocalOrcaProfileResult> {
  const profile = buildNewLocalProfile(args)
  const nextIndex = await mutateProfileIndexAsync(userDataPath, async (index) => {
    await mkdir(getOrcaProfileDirectory(profile.id, userDataPath), { recursive: true })
    return appendProfileToIndex(index, profile)
  })
  return {
    activeProfileId: nextIndex.activeProfileId,
    profiles: nextIndex.profiles,
    profile
  }
}

export async function setActiveOrcaProfileAsync(
  profileId: string,
  userDataPath = getProfileUserDataPath()
): Promise<OrcaProfileListState> {
  const nextIndex = await mutateProfileIndexAsync(userDataPath, async (index) => {
    // Why: validate before mkdir so an unknown id cannot leave a stray directory.
    const next = withActiveProfile(index, profileId)
    await mkdir(getOrcaProfileDirectory(profileId, userDataPath), { recursive: true })
    return next
  })
  return { activeProfileId: nextIndex.activeProfileId, profiles: nextIndex.profiles }
}

// Why: a brand-new profile has no data file, which the telemetry cohort
// migration reads as a fresh install and defaults to opted-in. Copying the
// active profile's consent block keeps an opted-out user opted out (and keeps
// one installId per install) when they create additional profiles.
export async function seedNewOrcaProfileTelemetryConsentAsync(
  profileId: string,
  telemetry: GlobalSettings['telemetry'],
  userDataPath = getProfileUserDataPath()
): Promise<void> {
  if (!telemetry) {
    return
  }
  const dataFile = getOrcaProfileDataFile(profileId, userDataPath)
  try {
    // Matches the sync twin's existsSync guard, which is also false for EACCES
    // and friends: never overwrite a data file this profile already has.
    await access(dataFile)
    return
  } catch {
    // Not seeded yet.
  }
  await mkdir(dirname(dataFile), { recursive: true })
  const tmpPath = `${dataFile}${ASYNC_TMP_SUFFIX}`
  try {
    // Why tmp+rename and not an in-place write: a torn write on a stalled mount
    // would leave a partial JSON document at the real path, which the store
    // then reads as a corrupt profile.
    await writeFile(tmpPath, JSON.stringify({ settings: { telemetry } }, null, 2), 'utf-8')
    await rename(tmpPath, dataFile)
  } catch (error) {
    await unlink(tmpPath).catch(() => {})
    throw error
  }
}
