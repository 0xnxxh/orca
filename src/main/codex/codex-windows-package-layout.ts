import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import { resolveCodexCommand } from '../codex-cli/command'
import {
  codexPackageDirectoryHasEntries,
  copyCodexPackageManifestIfMissing,
  findCodexWindowsPackageDonor,
  restoreCodexPackageDirectory
} from './codex-windows-package-layout-filesystem'

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
const NO_DONOR_CACHE_TTL_MS = 60_000

let noDonorCache: { key: string; expiresAt: number } | null = null

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
    (dirName) => !codexPackageDirectoryHasEntries(join(packageRootPath, dirName))
  )
  if (missingDirNames.length === 0) {
    return { status: 'already-complete', packageRootPath, restoredDirectories: [] }
  }

  const homePath = options.homePath ?? homedir()
  const appDataPath = options.appDataPath ?? process.env.APPDATA ?? null
  const noDonorCacheKey = getNoDonorCacheKey({
    entrypointPath,
    homePath,
    appDataPath,
    missingDirNames
  })
  if (noDonorCacheKey && noDonorCache?.key === noDonorCacheKey) {
    if (noDonorCache.expiresAt > Date.now()) {
      return { status: 'no-donor', packageRootPath, restoredDirectories: [] }
    }
    noDonorCache = null
  }

  const donorRootPath = findCodexWindowsPackageDonor({
    entrypointPath,
    homePath,
    appDataPath,
    packageRootPath,
    requiredDirNames: missingDirNames
  })
  if (!donorRootPath) {
    if (noDonorCacheKey) {
      noDonorCache = { key: noDonorCacheKey, expiresAt: Date.now() + NO_DONOR_CACHE_TTL_MS }
    }
    console.warn(
      '[codex-package-layout] Codex install is missing sandbox resources and no matching release was found:',
      packageRootPath,
      missingDirNames
    )
    return { status: 'no-donor', packageRootPath, restoredDirectories: [] }
  }

  const restoredDirectories: string[] = []
  for (const dirName of missingDirNames) {
    if (
      restoreCodexPackageDirectory(join(donorRootPath, dirName), join(packageRootPath, dirName))
    ) {
      restoredDirectories.push(dirName)
    }
  }
  if (restoredDirectories.length !== missingDirNames.length) {
    return { status: 'failed', packageRootPath, restoredDirectories }
  }
  copyCodexPackageManifestIfMissing(donorRootPath, packageRootPath)
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

function getNoDonorCacheKey({
  entrypointPath,
  homePath,
  appDataPath,
  missingDirNames
}: {
  entrypointPath: string
  homePath: string
  appDataPath: string | null
  missingDirNames: string[]
}): string | null {
  try {
    const stats = statSync(entrypointPath)
    if (!stats.isFile()) {
      return null
    }
    return JSON.stringify([
      entrypointPath,
      stats.size,
      stats.mtimeMs,
      homePath,
      appDataPath,
      missingDirNames
    ])
  } catch {
    return null
  }
}
