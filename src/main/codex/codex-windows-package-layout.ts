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
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import { resolveCodexCommand } from '../codex-cli/command'

/**
 * Restores the sibling directories a standalone Codex release declares next to
 * its entrypoint.
 *
 * Why: a release ships `bin/`, `codex-resources/` and `codex-path/` side by side
 * (declared in `codex-package.json`), but installers that copy only `bin/` leave
 * `codex-windows-sandbox-setup.exe` unreachable. Codex's elevated Windows sandbox
 * launches that helper through `ShellExecuteW`, which pops its own OS-level
 * "Windows cannot find ..." dialog on every tool call instead of surfacing an
 * error Orca or Codex could handle.
 */

const MANIFEST_FILE_NAME = 'codex-package.json'
const DEFAULT_RESOURCES_DIR_NAME = 'codex-resources'
const DEFAULT_PATH_DIR_NAME = 'codex-path'
const ENTRYPOINT_DIR_NAME = 'bin'
const HASH_CHUNK_BYTES = 1024 * 1024

export type CodexWindowsPackageLayoutStatus =
  | 'not-applicable'
  | 'already-complete'
  | 'restored'
  | 'no-donor'
  | 'failed'

export type CodexWindowsPackageLayoutResult = {
  status: CodexWindowsPackageLayoutStatus
  packageRootPath: string | null
  restoredDirectories: string[]
}

type PackageLayout = {
  resourcesDirName: string
  pathDirName: string
}

type RepairOptions = {
  platform?: NodeJS.Platform
  homePath?: string
  appDataPath?: string
  codexCommandPath?: string
}

export function repairCodexWindowsPackageLayout(
  options: RepairOptions = {}
): CodexWindowsPackageLayoutResult {
  const platform = options.platform ?? process.platform
  if (platform !== 'win32') {
    return notApplicable()
  }

  const entrypointPath = options.codexCommandPath ?? resolveCodexCommand()
  const packageRootPath = resolvePackageRootPath(entrypointPath)
  if (!packageRootPath) {
    return notApplicable()
  }

  const layout = readPackageLayout(packageRootPath)
  const missingDirNames = [layout.resourcesDirName, layout.pathDirName].filter(
    (dirName) => !directoryHasEntries(join(packageRootPath, dirName))
  )
  if (missingDirNames.length === 0) {
    return { status: 'already-complete', packageRootPath, restoredDirectories: [] }
  }

  const donorRootPath = findDonorPackageRootPath({
    entrypointPath,
    homePath: options.homePath ?? homedir(),
    appDataPath: options.appDataPath ?? process.env.APPDATA ?? null,
    packageRootPath,
    requiredDirNames: missingDirNames
  })
  if (!donorRootPath) {
    console.warn(
      '[codex-package-layout] Codex install is missing sandbox resources and no matching release was found:',
      packageRootPath,
      missingDirNames
    )
    return { status: 'no-donor', packageRootPath, restoredDirectories: [] }
  }

  const restoredDirectories: string[] = []
  for (const dirName of missingDirNames) {
    if (copyPackageDirectory(join(donorRootPath, dirName), join(packageRootPath, dirName))) {
      restoredDirectories.push(dirName)
    }
  }
  if (restoredDirectories.length !== missingDirNames.length) {
    return { status: 'failed', packageRootPath, restoredDirectories }
  }
  copyManifestIfMissing(donorRootPath, packageRootPath)
  console.log(
    '[codex-package-layout] Restored Codex sandbox resources from',
    donorRootPath,
    'into',
    packageRootPath,
    restoredDirectories
  )
  return { status: 'restored', packageRootPath, restoredDirectories }
}

function notApplicable(): CodexWindowsPackageLayoutResult {
  return { status: 'not-applicable', packageRootPath: null, restoredDirectories: [] }
}

// Why: only a release-layout entrypoint (`<root>/bin/codex.exe`) has declared
// siblings. A bare `codex`, a shim (`codex.cmd`/`codex.ps1`) or an exe outside a
// `bin/` directory is some other packaging that Orca must not write next to.
function resolvePackageRootPath(entrypointPath: string): string | null {
  if (extname(entrypointPath).toLowerCase() !== '.exe') {
    return null
  }
  const entrypointDirPath = dirname(entrypointPath)
  if (basename(entrypointDirPath).toLowerCase() !== ENTRYPOINT_DIR_NAME) {
    return null
  }
  const packageRootPath = dirname(entrypointDirPath)
  return packageRootPath === entrypointDirPath ? null : packageRootPath
}

function readPackageLayout(packageRootPath: string): PackageLayout {
  const manifest = readManifest(packageRootPath)
  return {
    resourcesDirName: manifest?.resourcesDirName ?? DEFAULT_RESOURCES_DIR_NAME,
    pathDirName: manifest?.pathDirName ?? DEFAULT_PATH_DIR_NAME
  }
}

function readManifest(packageRootPath: string): PackageLayout | null {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(join(packageRootPath, MANIFEST_FILE_NAME), 'utf-8')
    )
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }
    const record = parsed as Record<string, unknown>
    return {
      resourcesDirName: readRelativeDirName(record.resourcesDir) ?? DEFAULT_RESOURCES_DIR_NAME,
      pathDirName: readRelativeDirName(record.pathDir) ?? DEFAULT_PATH_DIR_NAME
    }
  } catch {
    return null
  }
}

// Why: the manifest is attacker-adjacent only in the sense that a corrupt value
// would make Orca copy into an arbitrary path. Accept single path segments only.
function readRelativeDirName(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) {
    return null
  }
  if (value === '.' || value === '..' || /[\\/]/.test(value)) {
    return null
  }
  return value
}

function directoryHasEntries(directoryPath: string): boolean {
  try {
    return statSync(directoryPath).isDirectory() && readdirSync(directoryPath).length > 0
  } catch {
    return false
  }
}

function findDonorPackageRootPath({
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
      requiredDirNames.every((dirName) => directoryHasEntries(join(candidate, dirName))) &&
      fileSize(candidateEntrypointPath(candidate)) === entrypointSize
  )
  if (candidates.length === 0) {
    return null
  }

  // Why: a helper from a different Codex build can be incompatible with the
  // running one, so only donate from a release whose entrypoint is byte-identical.
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

function candidateEntrypointPath(releaseRootPath: string): string {
  return join(releaseRootPath, ENTRYPOINT_DIR_NAME, 'codex.exe')
}

// Why: Codex keeps every downloaded standalone release under the user's real
// `~/.codex`, and the npm distribution vendors the same layout per target. Both
// are untouched copies of what the installer flattened into `bin/`.
function listReleaseRootPaths(homePath: string, appDataPath: string | null): string[] {
  return [
    ...listChildDirectories(join(homePath, '.codex', 'packages', 'standalone', 'releases')),
    ...listNpmVendorRootPaths(appDataPath)
  ]
}

// Why: the npm distribution nests the same release layout under a per-target
// platform package, so enumerate both levels instead of assuming an architecture.
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

// Why: Codex entrypoints are ~100 MB. Read in chunks so comparing candidates
// never holds the whole binary in memory.
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

// Why: publish through a rename so a Codex launch racing this repair never sees
// a half-copied resources directory and re-triggers the missing-helper dialog.
function copyPackageDirectory(sourcePath: string, targetPath: string): boolean {
  const stagingPath = `${targetPath}.orca-restore-${process.pid}`
  try {
    rmSync(stagingPath, { recursive: true, force: true })
    cpSync(sourcePath, stagingPath, { recursive: true })
    renameSync(stagingPath, targetPath)
    return true
  } catch (error) {
    // Why: another Orca process may have published the same directory first.
    if (directoryHasEntries(targetPath)) {
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

// Why: without the manifest the next check falls back to the default directory
// names, which would miss a release that renames them.
function copyManifestIfMissing(donorRootPath: string, packageRootPath: string): void {
  const targetPath = join(packageRootPath, MANIFEST_FILE_NAME)
  if (existsSync(targetPath)) {
    return
  }
  try {
    writeFileSync(targetPath, readFileSync(join(donorRootPath, MANIFEST_FILE_NAME)))
  } catch {
    // Why: the resources are already in place; a missing manifest only costs the
    // default-name fallback on the next launch.
  }
}
