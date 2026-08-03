import { createHash } from 'node:crypto'
import {
  closeSync,
  cpSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'

const ENTRYPOINT_DIR_NAME = 'bin'
const MANIFEST_FILE_NAME = 'codex-package.json'
const HASH_CHUNK_BYTES = 1024 * 1024

export function codexPackageDirectoryHasEntries(directoryPath: string): boolean {
  try {
    return statSync(directoryPath).isDirectory() && readdirSync(directoryPath).length > 0
  } catch {
    return false
  }
}

export function findCodexWindowsPackageDonor({
  entrypointPath,
  homePath,
  appDataPath,
  packageRootPath,
  requiredDirNames
}: {
  entrypointPath: string
  homePath: string
  appDataPath: string | null
  packageRootPath: string
  requiredDirNames: string[]
}): string | null {
  const entrypointSize = fileSize(entrypointPath)
  if (entrypointSize === null) {
    return null
  }
  const candidates = listReleaseRootPaths(homePath, appDataPath).filter(
    (candidate) =>
      candidate !== packageRootPath &&
      requiredDirNames.every((dirName) =>
        codexPackageDirectoryHasEntries(join(candidate, dirName))
      ) &&
      fileSize(candidateEntrypointPath(candidate)) === entrypointSize
  )
  if (candidates.length === 0) {
    return null
  }

  const entrypointHash = hashFile(entrypointPath)
  if (!entrypointHash) {
    return null
  }
  return (
    candidates.find(
      (candidate) => hashFile(candidateEntrypointPath(candidate)) === entrypointHash
    ) ?? null
  )
}

export function restoreCodexPackageDirectory(sourcePath: string, targetPath: string): boolean {
  const stagingPath = `${targetPath}.orca-restore-${process.pid}`
  try {
    rmSync(stagingPath, { recursive: true, force: true })
    cpSync(sourcePath, stagingPath, { recursive: true })
    // Why: a partial installer can leave an empty target directory behind.
    if (existsSync(targetPath)) {
      rmdirSync(targetPath)
    }
    renameSync(stagingPath, targetPath)
    return true
  } catch (error) {
    // Why: another Orca process may have published the same directory first.
    if (codexPackageDirectoryHasEntries(targetPath)) {
      rmSync(stagingPath, { recursive: true, force: true })
      return true
    }
    console.warn(
      '[codex-package-layout] Failed to restore Codex package directory:',
      targetPath,
      error
    )
    try {
      rmSync(stagingPath, { recursive: true, force: true })
    } catch (cleanupError) {
      console.warn(
        '[codex-package-layout] Failed to remove staged copy:',
        stagingPath,
        cleanupError
      )
    }
    return false
  }
}

export function copyCodexPackageManifestIfMissing(
  donorRootPath: string,
  packageRootPath: string
): void {
  const targetPath = join(packageRootPath, MANIFEST_FILE_NAME)
  if (existsSync(targetPath)) {
    return
  }
  try {
    writeFileSync(targetPath, readFileSync(join(donorRootPath, MANIFEST_FILE_NAME)))
  } catch {
    // Why: the resources are already in place; a missing manifest only costs the default-name fallback.
  }
}

function candidateEntrypointPath(releaseRootPath: string): string {
  return join(releaseRootPath, ENTRYPOINT_DIR_NAME, 'codex.exe')
}

function listReleaseRootPaths(homePath: string, appDataPath: string | null): string[] {
  return [
    ...listChildDirectories(join(homePath, '.codex', 'packages', 'standalone', 'releases')),
    ...listNpmVendorRootPaths(appDataPath)
  ]
}

function listNpmVendorRootPaths(appDataPath: string | null): string[] {
  if (!appDataPath) {
    return []
  }
  const platformPackagesDirPath = join(
    appDataPath,
    'npm',
    'node_modules',
    '@openai',
    'codex',
    'node_modules',
    '@openai'
  )
  return listChildDirectories(platformPackagesDirPath).flatMap((platformPackagePath) =>
    listChildDirectories(join(platformPackagePath, 'vendor'))
  )
}

function listChildDirectories(directoryPath: string): string[] {
  try {
    return readdirSync(directoryPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(directoryPath, entry.name))
  } catch {
    return []
  }
}

function fileSize(filePath: string): number | null {
  try {
    const stats = statSync(filePath)
    return stats.isFile() ? stats.size : null
  } catch {
    return null
  }
}

function hashFile(filePath: string): string | null {
  let handle: number | null = null
  try {
    handle = openSync(filePath, 'r')
    const hash = createHash('sha256')
    const buffer = Buffer.allocUnsafe(HASH_CHUNK_BYTES)
    for (;;) {
      const bytesRead = readSync(handle, buffer, 0, HASH_CHUNK_BYTES, null)
      if (bytesRead === 0) {
        break
      }
      hash.update(buffer.subarray(0, bytesRead))
    }
    return hash.digest('hex')
  } catch {
    return null
  } finally {
    if (handle !== null) {
      try {
        closeSync(handle)
      } catch {
        // Why: a failed close must not mask the hash result.
      }
    }
  }
}
