import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { existsSync } from 'node:fs'
import { posix, win32 } from 'node:path'
import { CLI_COMMAND_NAMES } from './cli-command-names'

export type CliLaunchRedirectResult = { redirected: false } | { redirected: true; status: number }

export type CliLaunchRedirectOptions = {
  argv?: string[]
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  isPackaged?: boolean
  resourcesPath?: string
  execPath?: string
  commandNames?: readonly string[]
  exists?: typeof existsSync
  spawn?: typeof spawnSync
}

const HELP_FLAGS = new Set(['--help', '-h', 'help'])
// Chromium switches an operator may put before the command on a direct binary
// launch. Node mode rejects unknown options, so they are stripped here; the
// sandbox choice is forwarded to the serve child via SERVE_NO_SANDBOX_ENV.
const DESKTOP_FLAGS = new Set(['--no-sandbox', '--disable-gpu'])
const CLI_FLAGS_WITH_VALUES = new Set(['--environment', '--pairing-code'])

// Why: set on the re-spawned node-mode child so a failure to honor
// ELECTRON_RUN_AS_NODE can't make us redirect forever in a tight loop.
const REDIRECT_ATTEMPT_ENV = 'ORCA_CLI_LAUNCH_REDIRECTED'
export const SERVE_NO_SANDBOX_ENV = 'ORCA_SERVE_NO_SANDBOX'

/**
 * Runs a CLI-shaped launch of the packaged binary as the CLI instead of booting
 * the desktop app.
 *
 * Why this is load-bearing rather than a fallback: on Linux the packaged
 * executable is an Electron binary, so a text-only command like `orca-ide
 * skills get` otherwise continues into Chromium startup and dies at Ozone
 * display initialization — reported as a SIGSEGV inside uv_close() with no
 * diagnosis (#13719, #14229). This runs at main-module scope, before
 * app.whenReady(), so the command is served by the CLI instead.
 *
 * What it deliberately cannot cover: Chromium's SUID sandbox check and zygote
 * host fatal *before any JavaScript runs*, so a direct launch of the binary on
 * a host where the sandbox cannot initialize is beyond reach from here. That is
 * why `resources/bin/orca-ide` — which exports ELECTRON_RUN_AS_NODE before exec
 * — remains the supported Linux CLI entrypoint, and why CLI registration always
 * points at it.
 *
 * Two launch shapes reach here:
 *  - entry-path form: the bundled launcher passes the unpacked CLI entry but
 *    something stripped ELECTRON_RUN_AS_NODE (a wrapper, or a shell that resets
 *    it), so Orca booted as a GUI and exited silently with no stdout.
 *  - command form: the binary was invoked directly with a CLI command, which is
 *    how the AppImage, an extracted tree, and a deb install are all documented
 *    to run `serve`.
 *
 * Security: the spawned program is always `execPath` and the script is always
 * `cliEntryPath`, derived solely from `resourcesPath` plus a fixed relative
 * path — never from argv. argv only contributes trailing arguments forwarded to
 * the already-trusted in-package CLI.
 */
export function maybeRedirectCliLaunch(
  options: CliLaunchRedirectOptions = {}
): CliLaunchRedirectResult {
  const argv = options.argv ?? process.argv
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const isPackaged = options.isPackaged ?? false
  const resourcesPath = options.resourcesPath ?? process.resourcesPath
  const execPath = options.execPath ?? process.execPath
  const exists = options.exists ?? existsSync
  const spawn = options.spawn ?? spawnSync
  const cliEntryPath = buildPackagedCliEntryPath(platform, resourcesPath)
  const cliArgs = getCliLaunchArgs(argv, cliEntryPath, {
    platform,
    isPackaged,
    commandNames: options.commandNames ?? CLI_COMMAND_NAMES
  })

  if (!cliArgs) {
    return { redirected: false }
  }
  if (env[REDIRECT_ATTEMPT_ENV] === '1') {
    process.stderr.write('Unable to start the Orca CLI through Electron node mode.\n')
    return { redirected: true, status: 1 }
  }
  if (!exists(cliEntryPath)) {
    process.stderr.write(`Unable to locate the Orca CLI entrypoint at ${cliEntryPath}\n`)
    return { redirected: true, status: 1 }
  }

  const childEnv = buildElectronRunAsNodeEnv(env)
  if (argv.slice(1).includes('--no-sandbox')) {
    // Why: the operator explicitly disabled Chromium's sandbox; preserve that choice when `serve` launches the Electron child.
    childEnv[SERVE_NO_SANDBOX_ENV] = '1'
  }
  const result = spawn(execPath, [cliEntryPath, ...cliArgs], {
    env: childEnv,
    stdio: 'inherit'
  }) as SpawnSyncReturns<Buffer>

  if (result.error) {
    process.stderr.write(`${result.error.message}\n`)
    return { redirected: true, status: 1 }
  }

  return { redirected: true, status: result.status ?? 1 }
}

/** The CLI arguments this launch should run, or null when it is not CLI-shaped. */
export function getCliLaunchArgs(
  argv: string[],
  cliEntryPath: string,
  options: {
    platform: NodeJS.Platform
    isPackaged: boolean
    commandNames: readonly string[]
  }
): string[] | null {
  if (!options.isPackaged) {
    return null
  }
  return (
    getEntryPathLaunchArgs(argv, cliEntryPath, options.platform) ??
    getCommandLaunchArgs(argv, options)
  )
}

/**
 * Arguments after an argv element that is exactly the in-package CLI entry.
 * Matching the computed path means this cannot be coerced into running another
 * script, and no in-tree launcher passes that path except the CLI ones.
 */
function getEntryPathLaunchArgs(
  argv: string[],
  cliEntryPath: string,
  platform: NodeJS.Platform
): string[] | null {
  const expectedCliPath = normalizePathForPlatform(cliEntryPath, platform)
  const cliEntryIndex = argv.findIndex(
    (arg, index) => index > 0 && normalizePathForPlatform(arg, platform) === expectedCliPath
  )
  return cliEntryIndex === -1 ? null : argv.slice(cliEntryIndex + 1)
}

/**
 * Arguments of a direct `<binary> <command> …` launch. Linux-only: it is the
 * only platform whose packaged executable is documented as a CLI entrypoint —
 * macOS and Windows always route through their bundled launcher, which uses the
 * entry-path form above.
 */
function getCommandLaunchArgs(
  argv: string[],
  options: { platform: NodeJS.Platform; commandNames: readonly string[] }
): string[] | null {
  if (options.platform !== 'linux') {
    return null
  }
  const args = argv.slice(1)
  if (args.length === 0) {
    return null
  }
  const cliArgs = args.filter((arg) => !DESKTOP_FLAGS.has(arg))
  if (cliArgs.some((arg) => HELP_FLAGS.has(arg))) {
    return cliArgs
  }

  const commandNames = new Set(options.commandNames)
  const firstPositional = findFirstCommandCandidate(cliArgs)
  return firstPositional && commandNames.has(firstPositional) ? cliArgs : null
}

function findFirstCommandCandidate(args: string[]): string | null {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (!arg.startsWith('-')) {
      return arg
    }
    const flagName = arg.includes('=') ? arg.slice(0, arg.indexOf('=')) : arg
    if (CLI_FLAGS_WITH_VALUES.has(flagName) && !arg.includes('=')) {
      index += 1
    }
  }
  return null
}

function buildPackagedCliEntryPath(platform: NodeJS.Platform, resourcesPath: string): string {
  return getPathApi(platform).join(resourcesPath, 'app.asar.unpacked', 'out', 'cli', 'index.js')
}

function normalizePathForPlatform(value: string, platform: NodeJS.Platform): string {
  const pathApi = getPathApi(platform)
  const normalized = pathApi.normalize(pathApi.isAbsolute(value) ? value : pathApi.resolve(value))
  // Why: Windows paths are case-insensitive, so compare case-folded.
  return platform === 'win32' ? normalized.toLowerCase() : normalized
}

function getPathApi(platform: NodeJS.Platform): typeof win32 | typeof posix {
  return platform === 'win32' ? win32 : posix
}

function buildElectronRunAsNodeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const childEnv = { ...env }
  // Why: the CLI re-reads these from the ORCA_-prefixed copies; clearing the
  // originals keeps Electron's own node bootstrap from inheriting them.
  childEnv.ORCA_NODE_OPTIONS = env.NODE_OPTIONS ?? ''
  childEnv.ORCA_NODE_REPL_EXTERNAL_MODULE = env.NODE_REPL_EXTERNAL_MODULE ?? ''
  childEnv.ELECTRON_RUN_AS_NODE = '1'
  childEnv[REDIRECT_ATTEMPT_ENV] = '1'
  delete childEnv.NODE_OPTIONS
  delete childEnv.NODE_REPL_EXTERNAL_MODULE
  return childEnv
}
