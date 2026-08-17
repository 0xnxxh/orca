import { existsSync } from 'node:fs'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { ensureAppImageExtractedRoot } from './appimage-extracted-root'
import { getBundledLauncherPath } from './cli-installer'
import { quoteShell } from './posix-shell-quote'

// Why: marks a dispatcher this function wrote so repeat serve starts overwrite
// our own file idempotently but never clobber a user's own ~/.local/bin/orca.
const DISPATCHER_MARKER = '# orca-serve-bare-orca-dispatcher'

export type LinuxBareOrcaDispatcherOptions = {
  /** Packaged app resources root; the bundled `orca-ide` launcher lives under it. */
  resourcesPath: string
  /** Test seam — defaults to the real home directory. */
  homePath?: string
  /** Test seam — defaults to $APPIMAGE (set only when running from an AppImage). */
  appImagePath?: string | null
  /** Test seam — defaults to $XDG_CACHE_HOME/orca/appimage. */
  appImageCacheRootPath?: string
  /** Test seam — defaults to running the AppImage's own `--appimage-extract`. */
  appImageExtractRunner?: (appImagePath: string, cwd: string) => Promise<void>
}

export type LinuxBareOrcaDispatcherState =
  | 'installed'
  | 'skipped-foreign'
  | 'skipped-launcher-missing'

export type LinuxBareOrcaDispatcherResult = {
  state: LinuxBareOrcaDispatcherState
  dispatcherPath: string
  /** The bundled `orca-ide` launcher the dispatcher execs. */
  target: string | null
}

// Why: on Linux the CLI installs as `orca-ide`, not bare `orca`, to avoid
// shadowing GNOME Orca's /usr/bin/orca. But the Claude Team launcher typed into
// the initial managed terminal invokes the literal `orca claude-teams`, so a
// headless serve box needs a bare-`orca` dispatcher on the managed-terminal PATH
// (~/.local/bin, which patchPackagedProcessPath puts ahead of /usr/bin). It is a
// plain file, not a managed symlink, so CliInstaller.removeLegacyLinuxCommandIfManaged
// never reclaims it.
export async function installLinuxBareOrcaDispatcher(
  options: LinuxBareOrcaDispatcherOptions
): Promise<LinuxBareOrcaDispatcherResult> {
  const dispatcherPath = join(options.homePath ?? homedir(), '.local', 'bin', 'orca')
  const launcher = await resolveStableLauncherPath(options)
  if (!launcher) {
    return { state: 'skipped-launcher-missing', dispatcherPath, target: null }
  }

  // Why: only (re)write a dispatcher we previously created; leave a user's own
  // `orca` untouched rather than silently clobbering it on every serve start.
  if (existsSync(dispatcherPath) && !(await isOwnedDispatcher(dispatcherPath))) {
    return { state: 'skipped-foreign', dispatcherPath, target: launcher }
  }

  await mkdir(dirname(dispatcherPath), { recursive: true })
  await writeFile(dispatcherPath, withMarker(buildBareOrcaCliScript(launcher)), 'utf8')
  await chmod(dispatcherPath, 0o755)
  return { state: 'installed', dispatcherPath, target: launcher }
}

/** Bare-`orca` script that execs the one Linux CLI launcher. */
export function buildBareOrcaCliScript(launcherPath: string): string {
  return `#!/usr/bin/env bash\nexec ${quoteShell(launcherPath)} "$@"\n`
}

/**
 * The launcher path this dispatcher can still reach on a later boot. Under an
 * AppImage `process.resourcesPath` is an ephemeral FUSE mount that dies with the
 * app, so extract the payload once and point at that stable copy instead.
 */
async function resolveStableLauncherPath(
  options: LinuxBareOrcaDispatcherOptions
): Promise<string | null> {
  const appImagePath = options.appImagePath ?? process.env.APPIMAGE ?? null
  if (appImagePath) {
    const extractedRoot = await ensureAppImageExtractedRoot({
      appImagePath,
      cacheRootPath: options.appImageCacheRootPath,
      runExtract: options.appImageExtractRunner
    })
    return extractedRoot?.launcherPath ?? null
  }
  const launcher = getBundledLauncherPath('linux', options.resourcesPath)
  // Why: getBundledLauncherPath only joins the path; guard existence so we never
  // write a script pointing at a missing launcher (which would fail at exec
  // time with a confusing error instead of the command-not-found we fix).
  return launcher && existsSync(launcher) ? launcher : null
}

function withMarker(script: string): string {
  const firstNewline = script.indexOf('\n')
  if (firstNewline === -1) {
    return `${script}\n${DISPATCHER_MARKER}\n`
  }
  // Keep the shebang on line 1; insert the marker immediately after it.
  return `${script.slice(0, firstNewline + 1)}${DISPATCHER_MARKER}\n${script.slice(firstNewline + 1)}`
}

async function isOwnedDispatcher(dispatcherPath: string): Promise<boolean> {
  try {
    return (await readFile(dispatcherPath, 'utf8')).includes(DISPATCHER_MARKER)
  } catch {
    return false
  }
}
