import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'

const execFile = promisify(execFileCb)

const OPENSSH_REGISTRY_PARENT_KEY = 'HKLM\\SOFTWARE'
const OPENSSH_REGISTRY_KEY = `${OPENSSH_REGISTRY_PARENT_KEY}\\OpenSSH`
const OPENSSH_REGISTRY_OUTPUT_KEY = 'HKEY_LOCAL_MACHINE\\SOFTWARE\\OPENSSH'
const QUERY_TIMEOUT_MS = 3000
const QUERY_OPTIONS = { encoding: 'utf8', timeout: QUERY_TIMEOUT_MS, windowsHide: true } as const
// Why: a failed probe must stay retryable, but a relay admitting a burst of PTY
// spawns must not re-run reg.exe once per spawn while the failure persists.
export const OPENSSH_DEFAULT_SHELL_RETRY_COOLDOWN_MS = 30_000

/**
 * Three distinct outcomes, deliberately not collapsed into `''`:
 * - `undefined` — never probed.
 * - `resolved` — the registry answered; `shell` is `''` when the key or value is
 *   absent. Cached for the process lifetime, same as before.
 * - `failed` — the probe could not establish an answer. Suppresses re-probing only
 *   until `retryAtMs`, so one transient registry error cannot permanently stop
 *   honoring the host's configured OpenSSH shell.
 */
type DefaultShellProbe =
  | { readonly kind: 'resolved'; readonly shell: string }
  | { readonly kind: 'failed'; readonly retryAtMs: number }

let probe: DefaultShellProbe | undefined
let inFlight: Promise<string> | undefined

function hasNumericExitCode(error: unknown): boolean {
  return typeof (error as { code?: unknown } | null)?.code === 'number'
}

function parseDefaultShell(output: string): string {
  const match = output.match(/^\s*DefaultShell\s+REG_\w+\s+(.+?)\s*$/im)
  return match?.[1] ?? ''
}

function outputContainsOpenSshKey(output: string): boolean {
  return output
    .split(/\r?\n/)
    .some((line) => line.trim().toUpperCase() === OPENSSH_REGISTRY_OUTPUT_KEY)
}

async function queryDefaultShell(): Promise<string> {
  try {
    const { stdout } = await execFile('reg.exe', ['query', OPENSSH_REGISTRY_KEY], QUERY_OPTIONS)
    return parseDefaultShell(stdout)
  } catch (error) {
    if (!hasNumericExitCode(error)) {
      throw error
    }

    // Why: reg.exe uses exit code 1 for both a missing key and access denied.
    // Parent enumeration distinguishes them without parsing localized stderr.
    const { stdout } = await execFile(
      'reg.exe',
      ['query', OPENSSH_REGISTRY_PARENT_KEY],
      QUERY_OPTIONS
    )
    if (outputContainsOpenSshKey(stdout)) {
      throw error
    }
    return ''
  }
}

/**
 * Read the OpenSSH `DefaultShell` registry value, or `''` when none is set or the
 * probe is in its post-failure cooldown. Async so a slow registry read cannot stall
 * the relay's event loop.
 */
export async function readOpenSshDefaultShell(): Promise<string> {
  if (probe?.kind === 'resolved') {
    return probe.shell
  }
  if (probe?.kind === 'failed' && performance.now() < probe.retryAtMs) {
    return ''
  }
  // Why: share one in-flight probe so concurrent spawns don't each launch reg.exe.
  inFlight ??= queryDefaultShell()
    .then((shell) => {
      probe = { kind: 'resolved', shell }
      return shell
    })
    .catch(() => {
      probe = {
        kind: 'failed',
        // Why monotonic: an NTP correction or VM resume must not stretch a 30s
        // cooldown into an hour of not honoring the configured shell.
        retryAtMs: performance.now() + OPENSSH_DEFAULT_SHELL_RETRY_COOLDOWN_MS
      }
      return ''
    })
    .finally(() => {
      inFlight = undefined
    })

  return inFlight
}
