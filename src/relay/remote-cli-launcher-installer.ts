import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { access, chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, posix, win32 } from 'node:path'
import { promisify } from 'node:util'
import {
  SSH_REMOTE_CLI_LAUNCHER_INSTALL_METHOD,
  SSH_REMOTE_CLI_LAUNCHER_INSTALL_VERSION,
  parseSshRemoteCliLauncherInstallRequest,
  type SshRemoteCliLauncherInstallRequest,
  type SshRemoteCliLauncherInstallResult
} from '../shared/ssh-remote-cli-launcher-install'
import type { RelayDispatcher, RequestContext } from './dispatcher'
import { WINDOWS_REMOTE_CLI_LAUNCHER_SOURCE } from './remote-cli-windows-launcher-source'

const execFileAsync = promisify(execFile)
const INSTALL_MARKER_NAME = '.orca-launcher.sha256'
const COMPILER_TIMEOUT_MS = 45_000
const COMPILER_OUTPUT_LIMIT_BYTES = 1024 * 1024

type InstallPlatform = 'posix' | 'win32'

export type RemoteCliLauncherPlan = {
  platform: InstallPlatform
  binDir: string
  launcherPath: string
  markerPath: string
  source: string
  sourceDigest: string
}

function quoteSh(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

function createPosixLauncherSource(request: SshRemoteCliLauncherInstallRequest): string {
  return [
    '#!/usr/bin/env sh',
    'set -eu',
    `ORCA_RELAY_NODE_PATH=\${ORCA_RELAY_NODE_PATH:-${quoteSh(request.nodePath)}}`,
    `ORCA_RELAY_DIR=\${ORCA_RELAY_DIR:-${quoteSh(request.relayDir)}}`,
    `ORCA_RELAY_SOCKET_PATH=\${ORCA_RELAY_SOCKET_PATH:-${quoteSh(request.sockPath)}}`,
    `ORCA_RELAY_CREDENTIAL_FILE=\${ORCA_RELAY_CREDENTIAL_FILE:-${quoteSh(request.credentialFile ?? `${request.sockPath}.credential`)}}`,
    'if [ ! -S "$ORCA_RELAY_SOCKET_PATH" ]; then',
    '  echo "Orca SSH CLI bridge cannot find the relay socket: $ORCA_RELAY_SOCKET_PATH" >&2',
    '  exit 1',
    'fi',
    'exec "$ORCA_RELAY_NODE_PATH" "$ORCA_RELAY_DIR/relay.js" --sock-path "$ORCA_RELAY_SOCKET_PATH" --credential-file "$ORCA_RELAY_CREDENTIAL_FILE" --orca-cli "$@"',
    ''
  ].join('\n')
}

function installPlatformForNode(platform: NodeJS.Platform): InstallPlatform {
  return platform === 'win32' ? 'win32' : 'posix'
}

function pathOpsForPlatform(platform: InstallPlatform): typeof posix | typeof win32 {
  return platform === 'win32' ? win32 : posix
}

function sourceDigest(platform: InstallPlatform, source: string): string {
  return createHash('sha256').update(`${platform}\0${source}`).digest('hex')
}

export function createRemoteCliLauncherPlan(
  requestValue: unknown,
  platform: InstallPlatform = installPlatformForNode(process.platform)
): RemoteCliLauncherPlan {
  const request = parseSshRemoteCliLauncherInstallRequest(requestValue)
  const pathOps = pathOpsForPlatform(platform)
  const requiredAbsolutePaths = [request.binDir, request.relayDir, request.nodePath]
  if (
    requiredAbsolutePaths.some((value) => !pathOps.isAbsolute(value)) ||
    (request.credentialFile !== undefined && !pathOps.isAbsolute(request.credentialFile)) ||
    !isAbsoluteRelaySocketPath(request.sockPath, platform)
  ) {
    throw new Error('remote_cli_launcher_path_not_absolute')
  }
  const binDir = pathOps.normalize(request.binDir)
  const source =
    platform === 'win32' ? WINDOWS_REMOTE_CLI_LAUNCHER_SOURCE : createPosixLauncherSource(request)
  return {
    platform,
    binDir,
    launcherPath: pathOps.join(binDir, platform === 'win32' ? 'orca.exe' : 'orca'),
    markerPath: pathOps.join(binDir, INSTALL_MARKER_NAME),
    source,
    sourceDigest: sourceDigest(platform, source)
  }
}

function isAbsoluteRelaySocketPath(value: string, platform: InstallPlatform): boolean {
  return platform === 'win32'
    ? win32.isAbsolute(value) || /^\\\\[.?]\\pipe\\/iu.test(value)
    : posix.isAbsolute(value)
}

function throwIfRequestStale(context: RequestContext): void {
  if (context.signal?.aborted || context.isStale()) {
    throw new Error('client_disconnected')
  }
}

async function readCurrentInstall(plan: RemoteCliLauncherPlan): Promise<boolean> {
  try {
    const [marker, launcherStat] = await Promise.all([
      readFile(plan.markerPath, 'utf8'),
      stat(plan.launcherPath)
    ])
    if (!launcherStat.isFile() || marker.trim() !== plan.sourceDigest) {
      return false
    }
    if (plan.platform === 'posix' && (launcherStat.mode & 0o111) === 0) {
      await chmod(plan.launcherPath, 0o755)
    }
    return true
  } catch {
    return false
  }
}

async function writeAtomicText(
  targetPath: string,
  contents: string,
  context: RequestContext,
  mode?: number
): Promise<void> {
  const pathOps = pathOpsForPlatform(installPlatformForNode(process.platform))
  const temporaryPath = pathOps.join(
    pathOps.dirname(targetPath),
    `.${pathOps.basename(targetPath)}.${randomUUID()}.tmp`
  )
  try {
    await writeFile(temporaryPath, contents, {
      encoding: 'utf8',
      flag: 'wx',
      ...(mode === undefined ? {} : { mode }),
      ...(context.signal ? { signal: context.signal } : {})
    })
    if (mode !== undefined) {
      await chmod(temporaryPath, mode)
    }
    throwIfRequestStale(context)
    await rename(temporaryPath, targetPath)
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => {})
  }
}

async function installPosixLauncher(
  plan: RemoteCliLauncherPlan,
  context: RequestContext
): Promise<void> {
  await writeAtomicText(plan.launcherPath, plan.source, context, 0o755)
}

export function windowsRemoteCliCompilerCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const windowsDirectory = env.WINDIR || env.SystemRoot
  if (!windowsDirectory) {
    return []
  }
  return [
    win32.join(windowsDirectory, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
    win32.join(windowsDirectory, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe')
  ]
}

async function resolveWindowsCompiler(): Promise<string> {
  for (const candidate of windowsRemoteCliCompilerCandidates()) {
    try {
      await access(candidate, constants.F_OK)
      return candidate
    } catch {
      // Try the 32-bit .NET Framework compiler next.
    }
  }
  throw new Error('remote_cli_launcher_compiler_unavailable')
}

async function installWindowsLauncher(
  plan: RemoteCliLauncherPlan,
  context: RequestContext
): Promise<void> {
  const token = randomUUID()
  const sourcePath = win32.join(plan.binDir, `.orca-launcher.${token}.cs`)
  const outputPath = win32.join(plan.binDir, `.orca.${token}.exe`)
  const legacyShimPath = win32.join(plan.binDir, 'orca.cmd')
  try {
    await writeFile(sourcePath, plan.source, {
      encoding: 'utf8',
      flag: 'wx',
      ...(context.signal ? { signal: context.signal } : {})
    })
    const compiler = await resolveWindowsCompiler()
    throwIfRequestStale(context)
    await execFileAsync(
      compiler,
      [
        '/nologo',
        '/target:exe',
        '/optimize+',
        '/warnaserror+',
        `/out:${basename(outputPath)}`,
        basename(sourcePath)
      ],
      {
        cwd: plan.binDir,
        encoding: 'utf8',
        windowsHide: true,
        timeout: COMPILER_TIMEOUT_MS,
        maxBuffer: COMPILER_OUTPUT_LIMIT_BYTES,
        ...(context.signal ? { signal: context.signal } : {})
      }
    )
    const outputStat = await stat(outputPath)
    if (!outputStat.isFile()) {
      throw new Error('remote_cli_launcher_compiler_produced_no_output')
    }
    throwIfRequestStale(context)
    await rename(outputPath, plan.launcherPath)
    await rm(legacyShimPath, { force: true }).catch(() => {})
  } finally {
    await Promise.all([
      rm(sourcePath, { force: true }).catch(() => {}),
      rm(outputPath, { force: true }).catch(() => {})
    ])
  }
}

async function installLauncher(
  plan: RemoteCliLauncherPlan,
  context: RequestContext
): Promise<SshRemoteCliLauncherInstallResult> {
  throwIfRequestStale(context)
  await mkdir(plan.binDir, { recursive: true })
  if (await readCurrentInstall(plan)) {
    return {
      version: SSH_REMOTE_CLI_LAUNCHER_INSTALL_VERSION,
      launcherPath: plan.launcherPath,
      changed: false
    }
  }
  await (plan.platform === 'win32'
    ? installWindowsLauncher(plan, context)
    : installPosixLauncher(plan, context))
  await writeAtomicText(plan.markerPath, `${plan.sourceDigest}\n`, context).catch(() => {})
  return {
    version: SSH_REMOTE_CLI_LAUNCHER_INSTALL_VERSION,
    launcherPath: plan.launcherPath,
    changed: true
  }
}

export class RemoteCliLauncherInstaller {
  private readonly installTails = new Map<string, Promise<SshRemoteCliLauncherInstallResult>>()

  constructor(dispatcher: RelayDispatcher) {
    dispatcher.onRequest(SSH_REMOTE_CLI_LAUNCHER_INSTALL_METHOD, (params, context) =>
      this.install(params, context)
    )
  }

  private async install(
    requestValue: unknown,
    context: RequestContext
  ): Promise<SshRemoteCliLauncherInstallResult> {
    const plan = createRemoteCliLauncherPlan(requestValue)
    const previous = this.installTails.get(plan.binDir)
    const current = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(() =>
      installLauncher(plan, context)
    )
    this.installTails.set(plan.binDir, current)
    try {
      return await current
    } finally {
      if (this.installTails.get(plan.binDir) === current) {
        this.installTails.delete(plan.binDir)
      }
    }
  }
}
