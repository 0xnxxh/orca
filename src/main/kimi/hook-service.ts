import { copyFile, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, posix as pathPosix } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { SFTPWrapper } from 'ssh2'
import type { AgentHookInstallState, AgentHookInstallStatus } from '../../shared/agent-hook-types'
import {
  createManagedCommandMatcher,
  getSharedManagedScriptPath,
  wrapPosixHookCommand,
  writeManagedScriptAsync
} from '../agent-hooks/installer-utils'
import {
  readTextFileRemote,
  writeManagedScriptRemote,
  writeTextFileRemoteAtomic
} from '../agent-hooks/installer-utils-remote'
import { buildPosixHookPayloadCapture } from '../agent-hooks/hook-stdin-contract'
import {
  applyManagedKimiHooks,
  KIMI_HOOK_EVENTS,
  readManagedKimiHookEvents,
  removeManagedKimiHooks
} from './kimi-hook-config-toml'

// Why: match the CLI's `KIMI_CODE_HOME ?? ~/.kimi-code` resolution (also used by
// kimi-fetcher.ts and the AI Vault session scanner) so hooks land in the same
// home Kimi reads at launch.
function getKimiHome(): string {
  return process.env.KIMI_CODE_HOME?.trim() || join(homedir(), '.kimi-code')
}

function getConfigPath(): string {
  return join(getKimiHome(), 'config.toml')
}

// Always a POSIX `.sh` script: Kimi runs hook commands through its shell, which
// is Git Bash even on Windows (see the CLI README / KIMI_SHELL_PATH), so a
// single curl-based script body works on every platform.
const MANAGED_SCRIPT_FILE_NAME = 'kimi-hook.sh'

function getManagedScriptPath(): string {
  return getSharedManagedScriptPath(MANAGED_SCRIPT_FILE_NAME)
}

function getManagedCommand(scriptPath: string): string {
  // Forward slashes so Kimi's Git Bash shell accepts the path on Windows.
  const posixPath = process.platform === 'win32' ? scriptPath.replaceAll('\\', '/') : scriptPath
  return wrapPosixHookCommand(posixPath)
}

function getManagedScript(): string {
  return [
    '#!/bin/sh',
    ...buildPosixHookPayloadCapture(),
    // Why: refresh PORT/TOKEN/ENV/VERSION from the current Orca install so a PTY
    // that survived an Orca restart still reaches the live listener. See
    // claude/hook-service.ts for the full rationale.
    'if [ -n "$ORCA_AGENT_HOOK_ENDPOINT" ] && [ -r "$ORCA_AGENT_HOOK_ENDPOINT" ]; then',
    '  . "$ORCA_AGENT_HOOK_ENDPOINT" 2>/dev/null || :',
    'fi',
    'if [ -z "$ORCA_AGENT_HOOK_PORT" ] || [ -z "$ORCA_AGENT_HOOK_TOKEN" ] || [ -z "$ORCA_PANE_KEY" ]; then',
    '  exit 0',
    'fi',
    // Why: worktreeId embeds a filesystem path, so hand-building JSON in POSIX
    // shell is not safe once a path contains quotes or newlines. Post the raw
    // hook payload plus metadata as form fields and let the receiver parse it.
    // Why: pipe payload to curl's stdin (`payload@-`) instead of an inline
    // `payload=$VALUE` arg, so tens-of-KB tool output stays off the curl
    // command line (EDR command-line false positives). Wire body is identical.
    'printf \'%s\' "$payload" | curl -sS -X POST "http://127.0.0.1:${ORCA_AGENT_HOOK_PORT}/hook/kimi" \\',
    '  --connect-timeout 0.5 --max-time 1.5 \\',
    '  -H "Content-Type: application/x-www-form-urlencoded" \\',
    '  -H "X-Orca-Agent-Hook-Token: ${ORCA_AGENT_HOOK_TOKEN}" \\',
    '  --data-urlencode "paneKey=${ORCA_PANE_KEY}" \\',
    '  --data-urlencode "tabId=${ORCA_TAB_ID}" \\',
    '  --data-urlencode "launchToken=${ORCA_AGENT_LAUNCH_TOKEN}" \\',
    '  --data-urlencode "worktreeId=${ORCA_WORKTREE_ID}" \\',
    '  --data-urlencode "env=${ORCA_AGENT_HOOK_ENV}" \\',
    '  --data-urlencode "version=${ORCA_AGENT_HOOK_VERSION}" \\',
    '  --data-urlencode "payload@-" >/dev/null 2>&1 || true',
    'exit 0',
    ''
  ].join('\n')
}

// Why: async fs keeps a stalled ~/.kimi-code mount off the Electron main thread;
// a hung read now parks a threadpool slot instead of freezing the whole app.
function isMissingPath(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

// Returns the file text, '' when the config does not exist yet (Kimi creates it
// lazily), or null on an unreadable file so callers can report a structured error.
async function readConfigToml(configPath: string): Promise<string | null> {
  try {
    return await readFile(configPath, 'utf-8')
  } catch (error) {
    return isMissingPath(error) ? '' : null
  }
}

// Why: temp+rename keeps a hand-editable config.toml intact if a write is
// interrupted, and a single rolling .bak makes a bad write recoverable.
async function writeConfigToml(configPath: string, text: string): Promise<void> {
  const dir = dirname(configPath)
  await mkdir(dir, { recursive: true })
  try {
    if ((await readFile(configPath, 'utf-8')) === text) {
      return
    }
  } catch {
    // Absent or unreadable: fall through to the atomic write path.
  }
  const tmpPath = join(dir, `.${Date.now()}-${randomUUID()}.tmp`)
  try {
    await writeFile(tmpPath, text, 'utf-8')
    try {
      await copyFile(configPath, `${configPath}.bak`)
    } catch (error) {
      // No prior config to back up; any other failure still aborts the write.
      if (!isMissingPath(error)) {
        throw error
      }
    }
    await rename(tmpPath, configPath)
  } finally {
    // ENOENT after a successful rename is the normal case.
    await unlink(tmpPath).catch(() => {})
  }
}

// Why: sync fs serialized read-modify-write for free. Chain mutations so two
// overlapping install/remove calls can never rename config.toml out of order.
let pendingMutation: Promise<unknown> = Promise.resolve()

function serializeConfigMutation<T>(run: () => Promise<T>): Promise<T> {
  const next = pendingMutation.then(run, run)
  pendingMutation = next.catch(() => {})
  return next
}

function unreadableConfigStatus(configPath: string): AgentHookInstallStatus {
  return {
    agent: 'kimi',
    state: 'error',
    configPath,
    managedHooksPresent: false,
    detail: 'Could not read Kimi config.toml'
  }
}

function buildStatus(present: Set<string>, configPath: string): AgentHookInstallStatus {
  const missing = KIMI_HOOK_EVENTS.filter((event) => !present.has(event))
  let state: AgentHookInstallState
  let detail: string | null
  if (missing.length === 0) {
    state = 'installed'
    detail = null
  } else if (present.size === 0) {
    state = 'not_installed'
    detail = null
  } else {
    state = 'partial'
    detail = `Managed hook missing for events: ${missing.join(', ')}`
  }
  return { agent: 'kimi', state, configPath, managedHooksPresent: present.size > 0, detail }
}

export class KimiHookService {
  async getStatus(): Promise<AgentHookInstallStatus> {
    const configPath = getConfigPath()
    const text = await readConfigToml(configPath)
    if (text === null) {
      return unreadableConfigStatus(configPath)
    }
    const isManagedCommand = createManagedCommandMatcher(MANAGED_SCRIPT_FILE_NAME)
    return buildStatus(readManagedKimiHookEvents(text, isManagedCommand), configPath)
  }

  install(): Promise<AgentHookInstallStatus> {
    return serializeConfigMutation(async () => {
      const configPath = getConfigPath()
      const text = await readConfigToml(configPath)
      if (text === null) {
        return unreadableConfigStatus(configPath)
      }
      const scriptPath = getManagedScriptPath()
      const command = getManagedCommand(scriptPath)
      // Write the script first so config.toml never points at a missing script.
      await writeManagedScriptAsync(scriptPath, getManagedScript())
      await writeConfigToml(configPath, applyManagedKimiHooks(text, command))
      return this.getStatus()
    })
  }

  // Why: install Orca's managed Kimi hooks on a remote box over SFTP, mirroring
  // the local install. POSIX-only by design (Kimi's shell is sh/Git Bash); the
  // managed script body is already platform-independent.
  async installRemote(sftp: SFTPWrapper, remoteHome: string): Promise<AgentHookInstallStatus> {
    const remoteConfigPath = pathPosix.join(remoteHome, '.kimi-code', 'config.toml')
    const remoteScriptPath = pathPosix.join(
      remoteHome,
      '.orca',
      'agent-hooks',
      MANAGED_SCRIPT_FILE_NAME
    )
    try {
      // null (file absent) → start from an empty config; Kimi creates it lazily.
      const text = (await readTextFileRemote(sftp, remoteConfigPath)) ?? ''
      const command = wrapPosixHookCommand(remoteScriptPath)
      // Write the script first so config.toml never points at a missing script.
      await writeManagedScriptRemote(sftp, remoteScriptPath, getManagedScript())
      await writeTextFileRemoteAtomic(sftp, remoteConfigPath, applyManagedKimiHooks(text, command))
      return {
        agent: 'kimi',
        state: 'installed',
        configPath: remoteConfigPath,
        managedHooksPresent: true,
        detail: null
      }
    } catch (err) {
      return {
        agent: 'kimi',
        state: 'error',
        configPath: remoteConfigPath,
        managedHooksPresent: false,
        detail: err instanceof Error ? err.message : String(err)
      }
    }
  }

  remove(): Promise<AgentHookInstallStatus> {
    return serializeConfigMutation(async () => {
      const configPath = getConfigPath()
      const text = await readConfigToml(configPath)
      if (text === null) {
        return unreadableConfigStatus(configPath)
      }
      const { text: nextText, changed } = removeManagedKimiHooks(text)
      if (changed) {
        await writeConfigToml(configPath, nextText)
      }
      return this.getStatus()
    })
  }
}

export const kimiHookService = new KimiHookService()
