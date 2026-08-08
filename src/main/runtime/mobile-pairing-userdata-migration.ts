import { lstatSync, mkdirSync, realpathSync, rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  fsyncDirectorySync,
  removeFileDurableSync,
  renameFileDurableSync
} from '../../shared/durable-file-write'
import { hardenSecurePath } from '../../shared/secure-file'
import { loadDeviceRegistryForReset } from './device-registry'
import {
  DEVICE_REGISTRY_FILENAME,
  E2EE_KEYPAIR_BACKUP_FILENAME,
  E2EE_KEYPAIR_FILENAME,
  RELAY_REVOKE_OUTBOX_FILENAME,
  MOBILE_PAIRING_USERDATA_FILES
} from './mobile-pairing-files'
import { validateE2EEIdentityStorage } from './e2ee-keypair'
import {
  inspectE2EEIdentityStorage,
  type E2EEIdentityStorageInspection
} from './e2ee-keypair-storage'
import { loadRelayRevokeOutboxForReset } from './relay/relay-revoke-outbox'
import {
  areEquivalentStagedArtifacts,
  assertCompatibleIdentityResidue,
  isMutableArtifact,
  isValidStagedArtifact
} from './mobile-pairing-lifecycle-artifact-equivalence'
import { prepareMobilePairingStaging } from './mobile-pairing-userdata-staging'

const MIGRATION_STAGE_DIRECTORY = '.orca-mobile-pairing-migration'

/** Moves the pairing lifecycle as one validated, restartable publication. */
export function migrateMobilePairingUserdata(
  sourceUserDataDir: string,
  targetUserDataDir: string
): void {
  const stagingDir = join(targetUserDataDir, MIGRATION_STAGE_DIRECTORY)
  assertOwnedStagingDirectory(stagingDir, targetUserDataDir)
  if (sameDirectory(sourceUserDataDir, targetUserDataDir)) {
    return
  }

  let sourceFiles = presentLifecycleFiles(sourceUserDataDir)
  let targetFiles = presentLifecycleFiles(targetUserDataDir)
  let stagingFiles = presentLifecycleFiles(stagingDir)

  if (sourceFiles.size > 0) {
    assertLifecycleFiles(sourceUserDataDir)
  }
  sourceFiles = presentLifecycleFiles(sourceUserDataDir)

  // A target-prefix cut may leave a syntactically valid but incomplete record.
  const targetEstablished = targetFiles.size > 0 ? tryAssertLifecycleFiles(targetUserDataDir) : null
  targetFiles = presentLifecycleFiles(targetUserDataDir)
  stagingFiles = presentLifecycleFiles(stagingDir)

  if (stagingFiles.size > 0 || sourceFiles.size > 0) {
    const expectedFiles = new Set([...sourceFiles, ...targetFiles, ...stagingFiles])
    if (expectedFiles.size === 0) {
      return
    }
    prepareMobilePairingStaging(
      sourceUserDataDir,
      targetUserDataDir,
      stagingDir,
      expectedFiles,
      sourceFiles,
      sourceFiles.size > 0,
      targetEstablished !== null,
      assertOwnedStagingDirectory
    )
    assertOwnedStagingDirectory(stagingDir, targetUserDataDir)
    assertLifecycleFiles(stagingDir)
    assertActivationCompatibility(
      targetUserDataDir,
      stagingDir,
      expectedFiles,
      targetEstablished !== null
    )
    activateStagedLifecycle(
      targetUserDataDir,
      stagingDir,
      expectedFiles,
      targetEstablished !== null
    )
    assertOwnedStagingDirectory(stagingDir, targetUserDataDir)
    assertLifecycleFiles(targetUserDataDir)
    assertOwnedStagingDirectory(stagingDir, targetUserDataDir)
    rmSync(stagingDir, { recursive: true, force: true })
    fsyncDirectorySync(targetUserDataDir)
    return
  }

  if (targetFiles.size > 0) {
    assertLifecycleFiles(targetUserDataDir)
  }
}

function activateStagedLifecycle(
  targetDir: string,
  stagingDir: string,
  expectedFiles: ReadonlySet<string>,
  preserveTargetMutable: boolean
): void {
  assertOwnedStagingDirectory(stagingDir, targetDir)
  mkdirSync(targetDir, { recursive: true, mode: 0o700 })
  hardenSecurePath(targetDir, { isDirectory: true, platform: process.platform, sync: true })
  const movedFiles: string[] = []
  try {
    for (const fileName of expectedFiles) {
      assertOwnedStagingDirectory(stagingDir, targetDir)
      const stagedPath = join(stagingDir, fileName)
      const targetPath = join(targetDir, fileName)
      if (!pathExists(stagedPath)) {
        if (pathExists(targetPath)) {
          assertRegularFile(targetPath, `target ${fileName}`)
          if (isValidStagedArtifact(fileName, targetPath, targetDir)) {
            continue
          }
          // A complete candidate may intentionally omit malformed optional residue.
          assertOwnedStagingDirectory(stagingDir, targetDir)
          removeFileDurableSync(targetPath)
          continue
        }
        if (fileName === E2EE_KEYPAIR_BACKUP_FILENAME) {
          continue
        }
        throw new Error(`Canonical mobile pairing staging is missing ${fileName}`)
      }
      if (pathExists(targetPath)) {
        assertRegularFile(targetPath, `target ${fileName}`)
        const targetValid = isValidStagedArtifact(fileName, targetPath, targetDir)
        if (
          targetValid &&
          areEquivalentStagedArtifacts(fileName, stagedPath, stagingDir, targetPath, targetDir)
        ) {
          assertOwnedStagingDirectory(stagingDir, targetDir)
          removeFileDurableSync(stagedPath)
          continue
        }
        if (targetValid && isMutableArtifact(fileName) && preserveTargetMutable) {
          assertOwnedStagingDirectory(stagingDir, targetDir)
          removeFileDurableSync(stagedPath)
          continue
        }
        if (targetValid) {
          throw new Error(`Canonical mobile pairing target conflicts for ${fileName}`)
        }
        assertOwnedStagingDirectory(stagingDir, targetDir)
        removeFileDurableSync(targetPath)
      }
      assertOwnedStagingDirectory(stagingDir, targetDir)
      renameFileDurableSync(stagedPath, targetPath)
      movedFiles.push(fileName)
    }
  } catch (error) {
    for (const fileName of movedFiles) {
      try {
        assertOwnedStagingDirectory(stagingDir, targetDir)
        renameFileDurableSync(join(targetDir, fileName), join(stagingDir, fileName))
      } catch {
        // Keep the exact stage recoverable when rollback itself is interrupted.
      }
    }
    throw error
  }
}

function assertActivationCompatibility(
  targetDir: string,
  stagingDir: string,
  expectedFiles: ReadonlySet<string>,
  preserveTargetMutable: boolean
): void {
  assertCompatibleIdentityResidue(targetDir, stagingDir)
  for (const fileName of expectedFiles) {
    const targetPath = join(targetDir, fileName)
    const stagedPath = join(stagingDir, fileName)
    if (!pathExists(targetPath) || !pathExists(stagedPath)) {
      continue
    }
    assertRegularFile(targetPath, `target ${fileName}`)
    assertRegularFile(stagedPath, `staged ${fileName}`)
    const targetValid = isValidStagedArtifact(fileName, targetPath, targetDir)
    const stagedValid = isValidStagedArtifact(fileName, stagedPath, stagingDir)
    if (
      targetValid &&
      stagedValid &&
      (!isMutableArtifact(fileName) || !preserveTargetMutable) &&
      !areEquivalentStagedArtifacts(fileName, targetPath, targetDir, stagedPath, stagingDir)
    ) {
      throw new Error(
        fileName === E2EE_KEYPAIR_FILENAME
          ? 'Source and canonical mobile pairing data have different E2EE identity ownership'
          : `Canonical mobile pairing target conflicts for ${fileName}`
      )
    }
  }
}

function assertLifecycleFiles(userDataDir: string): E2EEIdentityStorageInspection {
  const files = presentLifecycleFiles(userDataDir)
  if (files.has(DEVICE_REGISTRY_FILENAME)) {
    loadDeviceRegistryForReset(userDataDir)
  }
  if (files.has(RELAY_REVOKE_OUTBOX_FILENAME)) {
    loadRelayRevokeOutboxForReset(userDataDir)
  }
  const inspection = inspectE2EEIdentityStorage(userDataDir, {
    preserveReplacementBackup: true
  })
  validateE2EEIdentityStorage(userDataDir, { preserveReplacementBackup: true })
  if (files.size > 0 && !inspection.active && !inspection.stage) {
    throw new Error('Canonical mobile pairing data is missing a valid E2EE identity')
  }
  return inspection
}

function tryAssertLifecycleFiles(userDataDir: string): E2EEIdentityStorageInspection | null {
  try {
    return assertLifecycleFiles(userDataDir)
  } catch {
    return null
  }
}

function presentLifecycleFiles(userDataDir: string): Set<string> {
  const files = new Set<string>()
  for (const fileName of MOBILE_PAIRING_USERDATA_FILES) {
    if (pathExists(join(userDataDir, fileName))) {
      files.add(fileName)
    }
  }
  return files
}

function assertOwnedStagingDirectory(stagingDir: string, targetDir: string): void {
  let stagingStats
  try {
    stagingStats = lstatSync(stagingDir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return
    }
    throw new Error('Canonical mobile pairing staging directory is unavailable')
  }
  if (stagingStats.isSymbolicLink() || !stagingStats.isDirectory()) {
    throw new Error('Canonical mobile pairing staging directory is invalid')
  }

  let resolvedStagingDir: string
  let resolvedTargetDir: string
  try {
    resolvedStagingDir = realpathSync(stagingDir)
    resolvedTargetDir = realpathSync(targetDir)
  } catch {
    throw new Error('Canonical mobile pairing staging directory is unavailable')
  }
  if (pathKey(resolvedStagingDir) !== pathKey(join(resolvedTargetDir, MIGRATION_STAGE_DIRECTORY))) {
    throw new Error('Canonical mobile pairing staging directory is invalid')
  }
}

function sameDirectory(left: string, right: string): boolean {
  return directoryKey(left) === directoryKey(right)
}

function directoryKey(path: string): string {
  const resolved = resolve(path)
  try {
    return pathKey(realpathSync(resolved))
  } catch {
    return pathKey(resolved)
  }
}

function pathKey(path: string): string {
  return process.platform === 'win32' ? path.toLocaleLowerCase('en-US') : path
}

function pathExists(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false
    }
    throw error
  }
}

function assertRegularFile(path: string, field: string): void {
  try {
    if (lstatSync(path).isSymbolicLink() || !statSync(path).isFile()) {
      throw new Error(`${field} is invalid`)
    }
  } catch (error) {
    if (error instanceof Error && error.message === `${field} is invalid`) {
      throw error
    }
    throw new Error(`${field} is unavailable`)
  }
}
