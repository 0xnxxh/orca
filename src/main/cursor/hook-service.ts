import { homedir } from 'node:os'
import { join } from 'node:path'
import type { SFTPWrapper } from 'ssh2'
import type { AgentHookInstallState, AgentHookInstallStatus } from '../../shared/agent-hook-types'
import {
  buildManagedCommandDefinition,
  createManagedCommandMatcher,
  getSharedManagedScriptPath,
  readHooksJson,
  readHooksJsonAsync,
  removeManagedCommands,
  wrapPosixHookCommand,
  wrapWindowsHookCommand,
  writeHooksJson,
  writeHooksJsonAsync,
  writeManagedScript,
  writeManagedScriptAsync,
  type HookDefinition,
  type HooksConfig
} from '../agent-hooks/installer-utils'
import {
  readHooksJsonRemote,
  writeHooksJsonRemote,
  writeManagedScriptRemote
} from '../agent-hooks/installer-utils-remote'
import { getManagedScript } from './managed-hook-script'

// cursor-agent's declarative hooks surface (https://cursor.com/docs/hooks); subscribe to the minimum set for spinner + turn detection.
// sessionStart/sessionEnd are NOT subscribed: they fire at process (not turn) boundaries and can race/reset the just-submitted turn's prompt cache.
const CURSOR_EVENTS = [
  'beforeSubmitPrompt',
  'stop',
  'preToolUse',
  'postToolUse',
  'postToolUseFailure',
  'beforeShellExecution',
  'beforeMCPExecution',
  'afterAgentResponse'
] as const

function getConfigPath(): string {
  return join(homedir(), '.cursor', 'hooks.json')
}

function getManagedScriptFileName(): string {
  return process.platform === 'win32' ? 'cursor-hook.cmd' : 'cursor-hook.sh'
}

function getManagedScriptPath(): string {
  return getSharedManagedScriptPath(getManagedScriptFileName())
}

function getManagedCommand(scriptPath: string): string {
  return process.platform === 'win32'
    ? wrapWindowsHookCommand(scriptPath)
    : wrapPosixHookCommand(scriptPath)
}

function parseErrorStatus(configPath: string): AgentHookInstallStatus {
  return {
    agent: 'cursor',
    state: 'error',
    configPath,
    managedHooksPresent: false,
    detail: 'Could not parse Cursor hooks.json'
  }
}

function buildStatus(config: HooksConfig | null): AgentHookInstallStatus {
  const configPath = getConfigPath()
  const scriptPath = getManagedScriptPath()
  if (!config) {
    return parseErrorStatus(configPath)
  }

  const command = getManagedCommand(scriptPath)
  const missing: string[] = []
  let presentCount = 0
  for (const eventName of CURSOR_EVENTS) {
    const definitions = Array.isArray(config.hooks?.[eventName]) ? config.hooks![eventName]! : []
    // Why: Cursor puts command directly on the definition (Claude nests under `hooks`); match both shapes.
    const hasCommand = definitions.some(
      (definition) =>
        definition.command === command ||
        (definition.hooks ?? []).some((hook) => hook.command === command)
    )
    if (hasCommand) {
      presentCount += 1
    } else {
      missing.push(eventName)
    }
  }
  const managedHooksPresent = presentCount > 0
  let state: AgentHookInstallState
  let detail: string | null
  if (missing.length === 0) {
    state = 'installed'
    detail = null
  } else if (presentCount === 0) {
    state = 'not_installed'
    detail = null
  } else {
    state = 'partial'
    detail = `Managed hook missing for events: ${missing.join(', ')}`
  }
  return { agent: 'cursor', state, configPath, managedHooksPresent, detail }
}

export class CursorHookService {
  getStatus(): AgentHookInstallStatus {
    return buildStatus(readHooksJson(getConfigPath()))
  }

  // Why: main-thread twin — the sync one stays for the CLI process.
  async getStatusAsync(): Promise<AgentHookInstallStatus> {
    return buildStatus(await readHooksJsonAsync(getConfigPath()))
  }

  install(): AgentHookInstallStatus {
    const configPath = getConfigPath()
    const scriptPath = getManagedScriptPath()
    const config = readHooksJson(configPath)
    if (!config) {
      return parseErrorStatus(configPath)
    }

    const command = getManagedCommand(scriptPath)
    // Why: config.hooks is undefined on a fresh file with no prior hook install.
    const nextHooks = { ...config.hooks }
    const managedEvents = new Set<string>(CURSOR_EVENTS)

    // Why: match by script filename (not exact command) so installs sweep stale entries from older builds or a different userData path.
    const isManagedCommand = createManagedCommandMatcher(getManagedScriptFileName())

    // Why: sweep managed entries from events we no longer subscribe to, else upgraded users keep firing stale hooks.
    for (const [eventName, definitions] of Object.entries(nextHooks)) {
      if (managedEvents.has(eventName)) {
        continue
      }
      if (!Array.isArray(definitions)) {
        continue
      }
      const cleaned = removeManagedCommands(definitions, isManagedCommand)
      // Also strip entries with the command at the top level (Cursor schema).
      const strippedCursorShape = cleaned.filter(
        (definition) => !isManagedCommand(definition.command as string | undefined)
      )
      if (strippedCursorShape.length === 0) {
        delete nextHooks[eventName]
      } else {
        nextHooks[eventName] = strippedCursorShape
      }
    }

    for (const eventName of CURSOR_EVENTS) {
      const current = Array.isArray(nextHooks[eventName]) ? nextHooks[eventName] : []
      // Sweep both Claude-shaped (hooks[].command) and Cursor-shaped (definition.command) variants so installs converge on one entry.
      const cleaned = removeManagedCommands(current, isManagedCommand).filter(
        (definition) => !isManagedCommand(definition.command as string | undefined)
      )
      // Why: Cursor's schema puts `command` directly on the definition (not under `hooks`); emit that shape.
      const definition: HookDefinition = buildManagedCommandDefinition(command)
      nextHooks[eventName] = [...cleaned, definition]
    }

    // Why: cursor-agent's schema requires top-level `version: 1` (https://cursor.com/docs/hooks); keep any user-pinned value.
    const nextConfig: Record<string, unknown> = { ...config, hooks: nextHooks }
    if (nextConfig.version === undefined) {
      nextConfig.version = 1
    }
    writeManagedScript(scriptPath, getManagedScript())
    writeHooksJson(configPath, nextConfig)
    return this.getStatus()
  }

  async installAsync(): Promise<AgentHookInstallStatus> {
    const configPath = getConfigPath()
    const scriptPath = getManagedScriptPath()
    const config = await readHooksJsonAsync(configPath)
    if (!config) {
      return parseErrorStatus(configPath)
    }

    const command = getManagedCommand(scriptPath)
    // Why: config.hooks is undefined on a fresh file with no prior hook install.
    const nextHooks = { ...config.hooks }
    const managedEvents = new Set<string>(CURSOR_EVENTS)

    // Why: match by script filename (not exact command) so installs sweep stale entries from older builds or a different userData path.
    const isManagedCommand = createManagedCommandMatcher(getManagedScriptFileName())

    // Why: sweep managed entries from events we no longer subscribe to, else upgraded users keep firing stale hooks.
    for (const [eventName, definitions] of Object.entries(nextHooks)) {
      if (managedEvents.has(eventName)) {
        continue
      }
      if (!Array.isArray(definitions)) {
        continue
      }
      const cleaned = removeManagedCommands(definitions, isManagedCommand)
      // Also strip entries with the command at the top level (Cursor schema).
      const strippedCursorShape = cleaned.filter(
        (definition) => !isManagedCommand(definition.command as string | undefined)
      )
      if (strippedCursorShape.length === 0) {
        delete nextHooks[eventName]
      } else {
        nextHooks[eventName] = strippedCursorShape
      }
    }

    for (const eventName of CURSOR_EVENTS) {
      const current = Array.isArray(nextHooks[eventName]) ? nextHooks[eventName] : []
      // Sweep both Claude-shaped (hooks[].command) and Cursor-shaped (definition.command) variants so installs converge on one entry.
      const cleaned = removeManagedCommands(current, isManagedCommand).filter(
        (definition) => !isManagedCommand(definition.command as string | undefined)
      )
      // Why: Cursor's schema puts `command` directly on the definition (not under `hooks`); emit that shape.
      const definition: HookDefinition = buildManagedCommandDefinition(command)
      nextHooks[eventName] = [...cleaned, definition]
    }

    // Why: cursor-agent's schema requires top-level `version: 1` (https://cursor.com/docs/hooks); keep any user-pinned value.
    const nextConfig: Record<string, unknown> = { ...config, hooks: nextHooks }
    if (nextConfig.version === undefined) {
      nextConfig.version = 1
    }
    await writeManagedScriptAsync(scriptPath, getManagedScript())
    await writeHooksJsonAsync(configPath, nextConfig)
    return this.getStatusAsync()
  }

  // Installs managed Cursor hooks on an SSH remote (POSIX-only). See docs/design/agent-status-over-ssh.md §8.
  async installRemote(sftp: SFTPWrapper, remoteHome: string): Promise<AgentHookInstallStatus> {
    const remoteConfigPath = `${remoteHome.replace(/\/$/, '')}/.cursor/hooks.json`
    const remoteScriptPath = `${remoteHome.replace(/\/$/, '')}/.orca/agent-hooks/cursor-hook.sh`
    try {
      const config = await readHooksJsonRemote(sftp, remoteConfigPath)
      if (!config) {
        return {
          agent: 'cursor',
          state: 'error',
          configPath: remoteConfigPath,
          managedHooksPresent: false,
          detail: 'Could not parse remote Cursor hooks.json'
        }
      }

      const command = wrapPosixHookCommand(remoteScriptPath)
      const nextHooks = { ...config.hooks }
      const isManagedCommand = createManagedCommandMatcher('cursor-hook.sh')

      for (const eventName of CURSOR_EVENTS) {
        const current = Array.isArray(nextHooks[eventName]) ? nextHooks[eventName] : []
        // Why: dual-shape sweep so repeated installs converge on a single managed entry.
        const cleaned = removeManagedCommands(current, isManagedCommand).filter(
          (definition) => !isManagedCommand(definition.command as string | undefined)
        )
        const definition: HookDefinition = buildManagedCommandDefinition(command)
        nextHooks[eventName] = [...cleaned, definition]
      }

      const nextConfig: Record<string, unknown> = { ...config, hooks: nextHooks }
      if (nextConfig.version === undefined) {
        nextConfig.version = 1
      }

      // Why: script-then-config order so a partial mid-install leaves a working script nothing points at.
      // Why: SSH remotes always use POSIX `.sh` hook paths even when Orca runs on Windows; never derive from local OS.
      await writeManagedScriptRemote(sftp, remoteScriptPath, getManagedScript('posix'))
      await writeHooksJsonRemote(sftp, remoteConfigPath, nextConfig)

      return {
        agent: 'cursor',
        state: 'installed',
        configPath: remoteConfigPath,
        managedHooksPresent: true,
        detail: null
      }
    } catch (err) {
      return {
        agent: 'cursor',
        state: 'error',
        configPath: remoteConfigPath,
        managedHooksPresent: false,
        detail: err instanceof Error ? err.message : String(err)
      }
    }
  }

  remove(): AgentHookInstallStatus {
    const configPath = getConfigPath()
    const config = readHooksJson(configPath)
    if (!config) {
      return parseErrorStatus(configPath)
    }

    const nextHooks = { ...config.hooks }
    const isManagedCommand = createManagedCommandMatcher(getManagedScriptFileName())
    for (const [eventName, definitions] of Object.entries(nextHooks)) {
      if (!Array.isArray(definitions)) {
        continue
      }
      const cleaned = removeManagedCommands(definitions, isManagedCommand).filter(
        (definition) => !isManagedCommand(definition.command as string | undefined)
      )
      if (cleaned.length === 0) {
        delete nextHooks[eventName]
      } else {
        nextHooks[eventName] = cleaned
      }
    }
    const nextConfig = { ...config, hooks: nextHooks }
    writeHooksJson(configPath, nextConfig)
    return this.getStatus()
  }

  async removeAsync(): Promise<AgentHookInstallStatus> {
    const configPath = getConfigPath()
    const config = await readHooksJsonAsync(configPath)
    if (!config) {
      return parseErrorStatus(configPath)
    }

    const nextHooks = { ...config.hooks }
    const isManagedCommand = createManagedCommandMatcher(getManagedScriptFileName())
    for (const [eventName, definitions] of Object.entries(nextHooks)) {
      if (!Array.isArray(definitions)) {
        continue
      }
      const cleaned = removeManagedCommands(definitions, isManagedCommand).filter(
        (definition) => !isManagedCommand(definition.command as string | undefined)
      )
      if (cleaned.length === 0) {
        delete nextHooks[eventName]
      } else {
        nextHooks[eventName] = cleaned
      }
    }
    const nextConfig = { ...config, hooks: nextHooks }
    await writeHooksJsonAsync(configPath, nextConfig)
    return this.getStatusAsync()
  }
}

export const cursorHookService = new CursorHookService()
