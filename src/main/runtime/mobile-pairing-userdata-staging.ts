import { copyFileSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  fsyncFileSync,
  removeFileDurableSync,
  renameFileDurableSync
} from '../../shared/durable-file-write'
import { hardenExistingSecureFile, hardenSecurePath } from '../../shared/secure-file'
import { MOBILE_PAIRING_USERDATA_FILES } from './mobile-pairing-files'
import {
  areEquivalentStagedArtifacts,
  isMutableArtifact,
  isValidStagedArtifact
} from './mobile-pairing-lifecycle-artifact-equivalence'

type StagingDirectoryGuard = (stagingDir: string, targetDir: string) => void

export function prepareMobilePairingStaging(
  sourceDir: string,
  targetDir: string,
  stagingDir: string,
  expectedFiles: ReadonlySet<string>,
  sourceExpectedFiles: ReadonlySet<string>,
  sourceAvailable: boolean,
  preserveTargetMutable: boolean,
  assertOwnedStagingDirectory: StagingDirectoryGuard
): void {
  assertOwnedStagingDirectory(stagingDir, targetDir)
  mkdirSync(stagingDir, { recursive: true, mode: 0o700 })
  assertOwnedStagingDirectory(stagingDir, targetDir)
  hardenSecurePath(stagingDir, { isDirectory: true, platform: process.platform, sync: true })

  assertKnownStagingResidue(stagingDir, expectedFiles)
  for (const fileName of expectedFiles) {
    assertOwnedStagingDirectory(stagingDir, targetDir)
    const sourcePath = join(sourceDir, fileName)
    const stagedPath = join(stagingDir, fileName)
    const targetPath = join(targetDir, fileName)
    const sourceExists = sourceAvailable && pathExists(sourcePath)
    const stagedExists = pathExists(stagedPath)
    const targetExists = pathExists(targetPath)
    const copy = (artifactPath: string, drift: string): void =>
      copyArtifactToStaging(
        artifactPath,
        stagedPath,
        fileName,
        stagingDir,
        targetDir,
        assertOwnedStagingDirectory,
        drift
      )

    if (sourceAvailable && sourceExpectedFiles.has(fileName)) {
      if (!sourceExists) {
        throw new Error(`Canonical mobile pairing source is missing ${fileName}`)
      }
      assertRegularFile(sourcePath, `source ${fileName}`)
      if (!stagedExists) {
        copy(sourcePath, 'source changed during migration')
      } else {
        assertRegularFile(stagedPath, `staged ${fileName}`)
        if (
          !areEquivalentStagedArtifacts(fileName, sourcePath, sourceDir, stagedPath, stagingDir)
        ) {
          const stagedValid = isValidStagedArtifact(fileName, stagedPath, stagingDir)
          const targetValid = targetExists && isValidStagedArtifact(fileName, targetPath, targetDir)
          if (
            stagedValid &&
            (!isMutableArtifact(fileName) || !targetValid || !preserveTargetMutable)
          ) {
            throw new Error(`Canonical mobile pairing source changed during migration: ${fileName}`)
          }
          if (stagedValid) {
            continue
          }
          copy(sourcePath, 'source changed during migration')
        }
      }
      continue
    }

    if (stagedExists) {
      assertRegularFile(stagedPath, `staged ${fileName}`)
      if (targetExists) {
        assertRegularFile(targetPath, `target ${fileName}`)
        const stagedValid = isValidStagedArtifact(fileName, stagedPath, stagingDir)
        const targetValid = isValidStagedArtifact(fileName, targetPath, targetDir)
        if (stagedValid && targetValid) {
          if (
            areEquivalentStagedArtifacts(fileName, stagedPath, stagingDir, targetPath, targetDir)
          ) {
            continue
          }
          if (isMutableArtifact(fileName) && preserveTargetMutable) {
            continue
          }
          throw new Error(`Canonical mobile pairing target conflicts for ${fileName}`)
        }
        if (!stagedValid && targetValid && !isMutableArtifact(fileName)) {
          copy(targetPath, 'target changed during migration')
        }
      }
      continue
    }

    if (targetExists) {
      assertRegularFile(targetPath, `target ${fileName}`)
      if (isValidStagedArtifact(fileName, targetPath, targetDir)) {
        copy(targetPath, 'target changed during migration')
        continue
      }
      // Activation removes malformed target residue after the complete stage validates.
      continue
    }

    throw new Error(`Canonical mobile pairing staging is missing ${fileName}`)
  }
}

function copyArtifactToStaging(
  artifactPath: string,
  stagedPath: string,
  fileName: string,
  stagingDir: string,
  targetDir: string,
  assertOwnedStagingDirectory: StagingDirectoryGuard,
  driftDescription: string
): void {
  const temporaryPath = `${stagedPath}.tmp`
  if (pathExists(temporaryPath)) {
    assertRegularFile(temporaryPath, `temporary staged ${fileName}`)
    assertOwnedStagingDirectory(stagingDir, targetDir)
    removeFileDurableSync(temporaryPath)
  }
  assertOwnedStagingDirectory(stagingDir, targetDir)
  copyFileSync(artifactPath, temporaryPath)
  hardenExistingSecureFile(temporaryPath)
  fsyncFileSync(temporaryPath)
  assertOwnedStagingDirectory(stagingDir, targetDir)
  if (pathExists(stagedPath)) {
    assertRegularFile(stagedPath, `staged ${fileName}`)
    if (isValidStagedArtifact(fileName, stagedPath, stagingDir)) {
      throw new Error(`Canonical mobile pairing source changed during migration: ${fileName}`)
    }
    if (process.platform === 'win32') {
      removeFileDurableSync(stagedPath)
    }
  }
  renameFileDurableSync(temporaryPath, stagedPath)
  if (!sameCopiedBytes(artifactPath, stagedPath)) {
    throw new Error(`Canonical mobile pairing ${driftDescription}: ${fileName}`)
  }
}

function assertKnownStagingResidue(stagingDir: string, expectedFiles: ReadonlySet<string>): void {
  const knownFiles = new Set<string>(MOBILE_PAIRING_USERDATA_FILES)
  for (const fileName of readdirSync(stagingDir)) {
    const known = knownFiles.has(fileName)
    const temporary = fileName.endsWith('.tmp') && knownFiles.has(fileName.slice(0, -4))
    if ((known && expectedFiles.has(fileName)) || temporary) {
      continue
    }
    throw new Error(`Canonical mobile pairing staging has an unexpected ${fileName}`)
  }
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

function sameCopiedBytes(left: string, right: string): boolean {
  return readFileSync(left).equals(readFileSync(right))
}
