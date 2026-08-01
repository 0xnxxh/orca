import { homedir } from 'node:os'
import { join } from 'node:path'
import type { SFTPWrapper } from 'ssh2'
import type { AgentHookInstallState, AgentHookInstallStatus } from '../../shared/agent-hook-types'
import {
  buildManagedCommandHook,
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
import { buildCommandCodeManagedScript } from './command-code-managed-script'

const COMMAND_CODE_EVENTS = [
  {
    eventName: 'PreToolUse',
    definition: { matcher: '.*', hooks: [{ type: 'command', command: '' }] }
  },
  {
    eventName: 'PostToolUse',
    definition: { matcher: '.*', hooks: [{ type: 'command', command: '' }] }
  },
  { eventName: 'Stop', definition: { hooks: [{ type: 'command', command: '' }] } }
] as const

function getConfigPath(): string {
  return join(homedir(), '.commandcode', 'settings.json')
}

function getManagedScriptFileName(): string {
  return process.platform === 'win32' ? 'command-code-hook.cmd' : 'command-code-hook.sh'
}

function getManagedScriptPath(): string {
  return getSharedManagedScriptPath(getManagedScriptFileName())
}

function getManagedCommand(scriptPath: string): string {
  return process.platform === 'win32'
    ? wrapWindowsHookCommand(scriptPath)
    : wrapPosixHookCommand(scriptPath)
}

function buildInstalledConfig(config: HooksConfig, command: string, scriptFileName: string): void {
  const nextHooks = { ...config.hooks }
  const isManagedCommand = createManagedCommandMatcher(scriptFileName)
  const managedEvents = new Set<string>(COMMAND_CODE_EVENTS.map((event) => event.eventName))

  // Why: Orca owns only command-code-hook.* entries. Sweep retired managed
  // events while preserving user-authored Command Code hooks.
  for (const [eventName, definitions] of Object.entries(nextHooks)) {
    if (managedEvents.has(eventName) || !Array.isArray(definitions)) {
      continue
    }
    const cleaned = removeManagedCommands(definitions, isManagedCommand)
    if (cleaned.length === 0) {
      delete nextHooks[eventName]
    } else {
      nextHooks[eventName] = cleaned
    }
  }

  for (const event of COMMAND_CODE_EVENTS) {
    const current = Array.isArray(nextHooks[event.eventName]) ? nextHooks[event.eventName] : []
    const cleaned = removeManagedCommands(current, isManagedCommand)
    const definition: HookDefinition = {
      ...event.definition,
      hooks: [buildManagedCommandHook(command)]
    }
    nextHooks[event.eventName] = [...cleaned, definition]
  }

  config.hooks = nextHooks
}

function parseErrorStatus(configPath: string): AgentHookInstallStatus {
  return {
    agent: 'command-code',
    state: 'error',
    configPath,
    managedHooksPresent: false,
    detail: 'Could not parse Command Code settings.json'
  }
}

function stripManagedHooks(config: HooksConfig): void {
  const nextHooks = { ...config.hooks }
  const isManagedCommand = createManagedCommandMatcher(getManagedScriptFileName())
  for (const [eventName, definitions] of Object.entries(nextHooks)) {
    if (!Array.isArray(definitions)) {
      continue
    }
    const cleaned = removeManagedCommands(definitions, isManagedCommand)
    if (cleaned.length === 0) {
      delete nextHooks[eventName]
    } else {
      nextHooks[eventName] = cleaned
    }
  }
  config.hooks = nextHooks
}

function buildStatus(config: HooksConfig | null): AgentHookInstallStatus {
  const configPath = getConfigPath()
  if (!config) {
    return parseErrorStatus(configPath)
  }

  const command = getManagedCommand(getManagedScriptPath())
  const missing: string[] = []
  let presentCount = 0
  for (const event of COMMAND_CODE_EVENTS) {
    const definitions = Array.isArray(config.hooks?.[event.eventName])
      ? config.hooks![event.eventName]!
      : []
    const hasCommand = definitions.some((definition) =>
      (definition.hooks ?? []).some((hook) => hook.command === command)
    )
    if (hasCommand) {
      presentCount += 1
    } else {
      missing.push(event.eventName)
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
  return { agent: 'command-code', state, configPath, managedHooksPresent, detail }
}

export class CommandCodeHookService {
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

    buildInstalledConfig(config, getManagedCommand(scriptPath), getManagedScriptFileName())
    writeManagedScript(scriptPath, buildCommandCodeManagedScript())
    writeHooksJson(configPath, config)
    return this.getStatus()
  }

  async installAsync(): Promise<AgentHookInstallStatus> {
    const configPath = getConfigPath()
    const scriptPath = getManagedScriptPath()
    const config = await readHooksJsonAsync(configPath)
    if (!config) {
      return parseErrorStatus(configPath)
    }

    buildInstalledConfig(config, getManagedCommand(scriptPath), getManagedScriptFileName())
    await writeManagedScriptAsync(scriptPath, buildCommandCodeManagedScript())
    await writeHooksJsonAsync(configPath, config)
    return this.getStatusAsync()
  }

  async installRemote(sftp: SFTPWrapper, remoteHome: string): Promise<AgentHookInstallStatus> {
    const home = remoteHome.replace(/\/$/, '')
    const remoteConfigPath = `${home}/.commandcode/settings.json`
    const remoteScriptPath = `${home}/.orca/agent-hooks/command-code-hook.sh`
    try {
      const config = await readHooksJsonRemote(sftp, remoteConfigPath)
      if (!config) {
        return {
          agent: 'command-code',
          state: 'error',
          configPath: remoteConfigPath,
          managedHooksPresent: false,
          detail: 'Could not parse remote Command Code settings.json'
        }
      }

      buildInstalledConfig(config, wrapPosixHookCommand(remoteScriptPath), 'command-code-hook.sh')
      await writeManagedScriptRemote(sftp, remoteScriptPath, buildCommandCodeManagedScript('posix'))
      await writeHooksJsonRemote(sftp, remoteConfigPath, config)

      return {
        agent: 'command-code',
        state: 'installed',
        configPath: remoteConfigPath,
        managedHooksPresent: true,
        detail: null
      }
    } catch (err) {
      return {
        agent: 'command-code',
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
    stripManagedHooks(config)
    writeHooksJson(configPath, config)
    return this.getStatus()
  }

  async removeAsync(): Promise<AgentHookInstallStatus> {
    const configPath = getConfigPath()
    const config = await readHooksJsonAsync(configPath)
    if (!config) {
      return parseErrorStatus(configPath)
    }
    stripManagedHooks(config)
    await writeHooksJsonAsync(configPath, config)
    return this.getStatusAsync()
  }
}

export const commandCodeHookService = new CommandCodeHookService()
