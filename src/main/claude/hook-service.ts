import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { access, rm, writeFile } from 'node:fs/promises'
import type { SFTPWrapper } from 'ssh2'
import type { AgentHookInstallState, AgentHookInstallStatus } from '../../shared/agent-hook-types'
import {
  readHooksJson,
  readHooksJsonAsync,
  writeHooksJson,
  writeHooksJsonAsync,
  writeManagedScript,
  writeManagedScriptAsync,
  type HooksConfig
} from '../agent-hooks/installer-utils'
import {
  readHooksJsonRemote,
  writeHooksJsonRemote,
  writeManagedScriptRemote
} from '../agent-hooks/installer-utils-remote'
import { getManagedScript } from './managed-hook-script'
import { getManagedStatusLineScript } from './statusline-script'
import {
  applyManagedHooks,
  applyManagedStatusLine,
  CLAUDE_EVENTS,
  CLAUDE_HOOK_SETTINGS,
  getManagedScriptFileName,
  getConfigPath,
  getManagedCommand,
  getManagedScriptPath,
  getPosixManagedScriptFileName,
  getRemoteConfigPath,
  getRemoteManagedCommand,
  getStatusLineInstallMarkerPath,
  getStatusLineScriptFileName,
  getStatusLineScriptPath,
  getStatusLineSlotState,
  removeManagedHooks,
  removeManagedStatusLine,
  type ClaudeCompatibleHookSettings
} from './hook-settings'

type ClaudeHookServiceOptions = {
  agent: AgentHookInstallStatus['agent']
  displayName: string
  settings: ClaudeCompatibleHookSettings
}

const DEFAULT_CLAUDE_HOOK_SERVICE_OPTIONS: ClaudeHookServiceOptions = {
  agent: 'claude',
  displayName: 'Claude',
  settings: CLAUDE_HOOK_SETTINGS
}

// Why: pure existence probe with no follow-up read, so access(F_OK) is the honest async twin of existsSync.
async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export class ClaudeHookService {
  private readonly options: ClaudeHookServiceOptions

  constructor(options: ClaudeHookServiceOptions = DEFAULT_CLAUDE_HOOK_SERVICE_OPTIONS) {
    this.options = options
  }

  getStatus(): AgentHookInstallStatus {
    const configPath = getConfigPath(this.options.settings)
    return this.buildStatus(configPath, readHooksJson(configPath))
  }

  // Why: main-thread twin — the sync one stays for the CLI process.
  async getStatusAsync(): Promise<AgentHookInstallStatus> {
    const configPath = getConfigPath(this.options.settings)
    return this.buildStatus(configPath, await readHooksJsonAsync(configPath))
  }

  private parseErrorStatus(configPath: string): AgentHookInstallStatus {
    return {
      agent: this.options.agent,
      state: 'error',
      configPath,
      managedHooksPresent: false,
      detail: `Could not parse ${this.options.displayName} settings.json`
    }
  }

  private buildStatus(configPath: string, config: HooksConfig | null): AgentHookInstallStatus {
    const scriptPath = getManagedScriptPath(this.options.settings)
    if (!config) {
      return this.parseErrorStatus(configPath)
    }

    // Why: report `partial` when only some events are registered so the sidebar shows a degraded install, not a false-positive `installed`.
    const command = getManagedCommand(scriptPath)
    const missing: string[] = []
    let presentCount = 0
    for (const event of CLAUDE_EVENTS) {
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
    return { agent: this.options.agent, state, configPath, managedHooksPresent, detail }
  }

  install(): AgentHookInstallStatus {
    const configPath = getConfigPath(this.options.settings)
    const scriptPath = getManagedScriptPath(this.options.settings)
    const config = readHooksJson(configPath)
    if (!config) {
      return this.parseErrorStatus(configPath)
    }

    let nextConfig = applyManagedHooks(
      config,
      getManagedCommand(scriptPath),
      getManagedScriptFileName(this.options.settings)
    )
    writeManagedScript(scriptPath, this.getLocalManagedScript())
    // Why: the statusline usage feed is Claude-only — OpenClaude data would be misattributed to the Claude provider.
    if (this.options.agent === 'claude') {
      nextConfig = this.installManagedStatusLine(nextConfig)
    }
    writeHooksJson(configPath, nextConfig)
    return this.getStatus()
  }

  async installAsync(): Promise<AgentHookInstallStatus> {
    const configPath = getConfigPath(this.options.settings)
    const scriptPath = getManagedScriptPath(this.options.settings)
    const config = await readHooksJsonAsync(configPath)
    if (!config) {
      return this.parseErrorStatus(configPath)
    }

    let nextConfig = applyManagedHooks(
      config,
      getManagedCommand(scriptPath),
      getManagedScriptFileName(this.options.settings)
    )
    await writeManagedScriptAsync(scriptPath, this.getLocalManagedScript())
    if (this.options.agent === 'claude') {
      nextConfig = await this.installManagedStatusLineAsync(nextConfig)
    }
    await writeHooksJsonAsync(configPath, nextConfig)
    return this.getStatusAsync()
  }

  private getLocalManagedScript(): string {
    return getManagedScript('local', {
      skipWhenDevinImportsClaude: this.options.agent === 'claude'
    })
  }

  // Why: the statusline feed is opportunistic (usage display, not agent status); a user who deleted the
  // managed entry has opted out, and the marker distinguishes that deletion from a first install.
  private installManagedStatusLine(config: HooksConfig): HooksConfig {
    const scriptFileName = getStatusLineScriptFileName(this.options.settings)
    const markerPath = getStatusLineInstallMarkerPath(this.options.settings)
    if (this.shouldSkipManagedStatusLine(config, scriptFileName, existsSync(markerPath))) {
      return config
    }
    const statusLineScriptPath = getStatusLineScriptPath(this.options.settings)
    writeManagedScript(statusLineScriptPath, getManagedStatusLineScript('local'))
    const next = this.withManagedStatusLine(config, statusLineScriptPath, scriptFileName)
    try {
      writeFileSync(markerPath, '')
    } catch {
      // Best-effort: a missing marker only means one future user deletion gets re-installed once.
    }
    return next
  }

  private async installManagedStatusLineAsync(config: HooksConfig): Promise<HooksConfig> {
    const scriptFileName = getStatusLineScriptFileName(this.options.settings)
    const markerPath = getStatusLineInstallMarkerPath(this.options.settings)
    if (this.shouldSkipManagedStatusLine(config, scriptFileName, await pathExists(markerPath))) {
      return config
    }
    const statusLineScriptPath = getStatusLineScriptPath(this.options.settings)
    await writeManagedScriptAsync(statusLineScriptPath, getManagedStatusLineScript('local'))
    const next = this.withManagedStatusLine(config, statusLineScriptPath, scriptFileName)
    try {
      await writeFile(markerPath, '')
    } catch {
      // Best-effort: a missing marker only means one future user deletion gets re-installed once.
    }
    return next
  }

  private shouldSkipManagedStatusLine(
    config: HooksConfig,
    scriptFileName: string,
    markerExists: boolean
  ): boolean {
    const slot = getStatusLineSlotState(config, scriptFileName)
    return slot === 'user' || (slot === 'empty' && markerExists)
  }

  private withManagedStatusLine(
    config: HooksConfig,
    statusLineScriptPath: string,
    scriptFileName: string
  ): HooksConfig {
    return applyManagedStatusLine(config, getManagedCommand(statusLineScriptPath), scriptFileName)
  }

  // Why: install the Claude hook on the remote box (via SFTP); POSIX-only by design (Windows-remote deferred).
  async installRemote(sftp: SFTPWrapper, remoteHome: string): Promise<AgentHookInstallStatus> {
    // Why: remote-Windows is out of scope; ship POSIX paths. process.platform here is the local box, not the remote, so it can't gate this.
    const remoteConfigPath = getRemoteConfigPath(remoteHome, this.options.settings)
    const remoteScriptFileName = getPosixManagedScriptFileName(this.options.settings)
    const remoteScriptPath = `${remoteHome.replace(/\/$/, '')}/.orca/agent-hooks/${remoteScriptFileName}`
    // Why: SFTP I/O fails often (network/EACCES/disk); wrap install so transient failures surface as structured state:'error' rather than an unhandled rejection.
    try {
      const config = await readHooksJsonRemote(sftp, remoteConfigPath)
      if (!config) {
        return {
          agent: this.options.agent,
          state: 'error',
          configPath: remoteConfigPath,
          managedHooksPresent: false,
          detail: `Could not parse remote ${this.options.displayName} settings.json`
        }
      }

      // Why: the POSIX wrapper is identical regardless of where the script lands; only the path differs.
      const command = getRemoteManagedCommand(remoteScriptPath)
      const nextConfig = applyManagedHooks(config, command, remoteScriptFileName)

      // Why: write script before settings — a mid-install failure then leaves a harmless orphan script, not settings.json pointing at a missing one.
      // Why: SSH remotes use POSIX `.sh` paths even when Orca runs on Windows; never derive remote script syntax from the local OS.
      await writeManagedScriptRemote(
        sftp,
        remoteScriptPath,
        getManagedScript('posix', { skipWhenDevinImportsClaude: this.options.agent === 'claude' })
      )
      // Why: no statusline install here — this path serves SSH remotes and WSL guests, whose relay hook
      // listener doesn't route /statusline/claude, and an SSH box's Claude login can be a different
      // account than the locally selected one, so its usage must not feed the local bar (live feed is host-local only).
      await writeHooksJsonRemote(sftp, remoteConfigPath, nextConfig)

      return {
        agent: this.options.agent,
        state: 'installed',
        configPath: remoteConfigPath,
        managedHooksPresent: true,
        detail: null
      }
    } catch (err) {
      return {
        agent: this.options.agent,
        state: 'error',
        configPath: remoteConfigPath,
        managedHooksPresent: false,
        detail: err instanceof Error ? err.message : String(err)
      }
    }
  }

  remove(): AgentHookInstallStatus {
    const configPath = getConfigPath(this.options.settings)
    const config = readHooksJson(configPath)
    if (!config) {
      return this.parseErrorStatus(configPath)
    }
    const { config: nextConfig, changed } = this.planRemoval(config)
    if (changed) {
      writeHooksJson(configPath, nextConfig)
    }
    if (this.options.agent === 'claude') {
      try {
        // Why: an Orca-level uninstall resets the opt-out memory so a later re-enable installs the statusline again.
        rmSync(getStatusLineInstallMarkerPath(this.options.settings), { force: true })
      } catch {
        // ignore — marker cleanup is best-effort
      }
    }
    return this.getStatus()
  }

  async removeAsync(): Promise<AgentHookInstallStatus> {
    const configPath = getConfigPath(this.options.settings)
    const config = await readHooksJsonAsync(configPath)
    if (!config) {
      return this.parseErrorStatus(configPath)
    }
    const { config: nextConfig, changed } = this.planRemoval(config)
    if (changed) {
      await writeHooksJsonAsync(configPath, nextConfig)
    }
    if (this.options.agent === 'claude') {
      try {
        await rm(getStatusLineInstallMarkerPath(this.options.settings), { force: true })
      } catch {
        // ignore — marker cleanup is best-effort
      }
    }
    return this.getStatusAsync()
  }

  private planRemoval(config: HooksConfig): { config: HooksConfig; changed: boolean } {
    const { config: hooksRemoved, changed: hooksChanged } = removeManagedHooks(
      config,
      getManagedScriptFileName(this.options.settings)
    )
    const { config: nextConfig, changed: statusLineChanged } = removeManagedStatusLine(
      hooksRemoved,
      getStatusLineScriptFileName(this.options.settings)
    )
    return { config: nextConfig, changed: hooksChanged || statusLineChanged }
  }
}

export const claudeHookService = new ClaudeHookService()
