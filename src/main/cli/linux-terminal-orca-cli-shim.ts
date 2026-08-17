import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  isAppImageExtractionComplete,
  resolveAppImageExtractedRoot
} from './appimage-extracted-root'
import { getBundledLauncherPath } from './bundled-cli-launcher-path'
import { buildBareOrcaCliScript } from './linux-bare-orca-dispatcher'

const SHIM_DIR_NAME = 'linux-orca-cli-shim'

// Why: rewriting the shim on every PTY spawn is wasted fs work; the target only
// changes with the install itself, so one successful write per process is enough.
// Failures are NOT cached so a transient fs error retries on the next spawn.
const ensuredShimDirs = new Map<string, string>()

export type LinuxTerminalOrcaCliShimOptions = {
  userDataPath: string
  /** Test seam — defaults to the packaged resources root. */
  resourcesPath?: string | null
  /** Test seam — defaults to $APPIMAGE (set only when running from an AppImage). */
  appImagePath?: string | null
  /** Test seam — defaults to $XDG_CACHE_HOME/orca/appimage. */
  appImageCacheRootPath?: string
}

// Why: on Linux the CLI installs as `orca-ide` so it never shadows the GNOME
// Orca screen reader at /usr/bin/orca — but agent-facing surfaces (skills,
// dispatch preambles, CLI hints) all invoke bare `orca`, so on stock Ubuntu an
// agent inside an Orca terminal would launch the screen reader instead
// (stablyai/orca#7904). Prepending this userData-scoped shim dir to managed-PTY
// PATH makes bare `orca` resolve to the Orca CLI inside Orca terminals only,
// leaving the user's own shells (and their screen reader) untouched.
export function ensureLinuxTerminalOrcaCliShimDir(
  options: LinuxTerminalOrcaCliShimOptions
): string | null {
  const cached = ensuredShimDirs.get(options.userDataPath)
  if (cached !== undefined) {
    return cached
  }

  const launcher = resolveShimLauncherPath(options)
  if (!launcher) {
    return null
  }
  const script = buildBareOrcaCliScript(launcher)

  const shimDir = join(options.userDataPath, SHIM_DIR_NAME)
  const shimPath = join(shimDir, 'orca')
  try {
    if (readShim(shimPath) !== script) {
      mkdirSync(shimDir, { recursive: true })
      writeFileSync(shimPath, script, 'utf8')
    }
    // Why: always re-assert the exec bit — a shim written by an older run (or
    // restored from backup) with mode stripped would fail every agent CLI call.
    chmodSync(shimPath, 0o755)
  } catch {
    return null
  }
  ensuredShimDirs.set(options.userDataPath, shimDir)
  return shimDir
}

/**
 * Prefers an already-extracted AppImage payload because it outlives this app
 * process, but never triggers an extraction: a terminal spawn must not block on
 * ~540 MB of I/O. The live resources root is correct for every other install
 * method, and for an AppImage it is the current mount — good for as long as the
 * terminals using it exist.
 */
function resolveShimLauncherPath(options: LinuxTerminalOrcaCliShimOptions): string | null {
  const appImagePath = options.appImagePath ?? process.env.APPIMAGE ?? null
  if (appImagePath) {
    const extractedRoot = resolveAppImageExtractedRoot({
      appImagePath,
      cacheRootPath: options.appImageCacheRootPath
    })
    if (extractedRoot && isAppImageExtractionComplete(extractedRoot)) {
      return extractedRoot.launcherPath
    }
  }
  const resourcesPath = options.resourcesPath ?? process.resourcesPath
  if (!resourcesPath) {
    return null
  }
  const launcher = getBundledLauncherPath('linux', resourcesPath)
  return launcher && existsSync(launcher) ? launcher : null
}

function readShim(shimPath: string): string | null {
  try {
    return readFileSync(shimPath, 'utf8')
  } catch {
    return null
  }
}
