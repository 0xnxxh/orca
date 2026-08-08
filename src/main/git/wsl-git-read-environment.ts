import { execFile } from 'node:child_process'
import {
  buildWslLoginShellCommand,
  escapeWslShCommandForWindows
} from '../../shared/wsl-login-shell-command'

export type WslGitReadEnvironment = { gitPath: string; path: string }

const PROBE_MARKER = 'ORCA_WSL_GIT_READ_ENV_V1'
const PROBE_TIMEOUT_MS = 10_000
const PROBE_MAX_BUFFER = 64 * 1024
const environmentByDistro = new Map<string, Promise<WslGitReadEnvironment | null>>()
const resolvedEnvironmentByDistro = new Map<string, WslGitReadEnvironment>()

function parseProbe(stdout: string): WslGitReadEnvironment | null {
  const fields = stdout.split('\0')
  const markerIndex = fields.lastIndexOf(PROBE_MARKER)
  const path = fields[markerIndex + 1] ?? ''
  const gitPath = fields[markerIndex + 2] ?? ''
  if (
    markerIndex < 0 ||
    !path.includes('/') ||
    path.length > 32_768 ||
    !gitPath.startsWith('/') ||
    gitPath.includes('\n') ||
    gitPath.includes('\r')
  ) {
    return null
  }
  return { gitPath, path }
}

function probeWslGitReadEnvironment(distro: string): Promise<WslGitReadEnvironment | null> {
  const probeCommand = [
    '_orca_git_path=$(command -v git 2>/dev/null || true)',
    'case "$_orca_git_path" in /*) [ -x "$_orca_git_path" ] || exit 127 ;; *) exit 127 ;; esac',
    'if [ -n "${XDG_CONFIG_HOME:-}" ] || [ -n "${LD_LIBRARY_PATH:-}" ] || env | grep -q \'^GIT_\'; then exit 78; fi',
    `printf '\\0${PROBE_MARKER}\\0%s\\0%s\\0' "$PATH" "$_orca_git_path"`
  ].join('\n')
  const script = escapeWslShCommandForWindows(buildWslLoginShellCommand(probeCommand))
  return new Promise((resolve) => {
    execFile(
      'wsl.exe',
      ['-d', distro, '--', 'sh', '-lc', script],
      {
        encoding: 'utf8',
        maxBuffer: PROBE_MAX_BUFFER,
        timeout: PROBE_TIMEOUT_MS,
        windowsHide: true
      },
      (error, stdout) => resolve(error ? null : parseProbe(String(stdout)))
    )
  })
}

export function getWslGitReadEnvironment(distro: string): Promise<WslGitReadEnvironment | null> {
  let environment = environmentByDistro.get(distro)
  if (!environment) {
    environment = probeWslGitReadEnvironment(distro).then((resolved) => {
      if (resolved && environmentByDistro.get(distro) === environment) {
        resolvedEnvironmentByDistro.set(distro, resolved)
      }
      return resolved
    })
    environmentByDistro.set(distro, environment)
  }
  return environment
}

export function peekWslGitReadEnvironment(distro: string): WslGitReadEnvironment | undefined {
  return resolvedEnvironmentByDistro.get(distro)
}

export function invalidateWslGitReadEnvironment(distro: string): void {
  environmentByDistro.delete(distro)
  resolvedEnvironmentByDistro.delete(distro)
}

export function disableWslGitReadEnvironment(distro: string): void {
  environmentByDistro.set(distro, Promise.resolve(null))
  resolvedEnvironmentByDistro.delete(distro)
}

export function resetWslGitReadEnvironmentForTests(): void {
  environmentByDistro.clear()
  resolvedEnvironmentByDistro.clear()
}

export function seedWslGitReadEnvironmentForTests(
  distro: string,
  environment: WslGitReadEnvironment
): void {
  environmentByDistro.set(distro, Promise.resolve(environment))
  resolvedEnvironmentByDistro.set(distro, environment)
}
