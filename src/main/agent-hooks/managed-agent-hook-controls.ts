import type { AgentHookInstallStatus, AgentHookTarget } from '../../shared/agent-hook-types'
import {
  getManagedAgentHookTarget,
  isManagedAgentHookTarget
} from '../../shared/managed-agent-hook-targets'
import { normalizeDisabledTuiAgents } from '../../shared/tui-agent-selection'
import type { GlobalSettings } from '../../shared/types'
import { detectLocalManagedAgentCliPresence } from './local-agent-cli-presence'
import {
  MANAGED_AGENT_HOOK_INSTALLERS,
  MANAGED_AGENT_HOOK_REMOVERS,
  MANAGED_AGENT_HOOK_STATUS_READERS,
  type ManagedAgentHookInstaller
} from './managed-agent-hook-registry'

export { MANAGED_AGENT_HOOK_INSTALLERS } from './managed-agent-hook-registry'

type ManagedHookSettings = Partial<
  Pick<GlobalSettings, 'agentCmdOverrides' | 'disabledTuiAgents'>
> | null

type InstallOptions = {
  shouldHydrateShellPath?: boolean
  onInstallError?: (agent: AgentHookTarget, error: unknown) => void
  shouldContinue?: (agent: AgentHookTarget) => boolean
  agents?: readonly AgentHookTarget[]
}

type RemoveOptions = {
  agents?: readonly AgentHookTarget[]
}

export function isAgentStatusHooksEnabled(
  settings: Pick<GlobalSettings, 'agentStatusHooksEnabled'> | null | undefined
): boolean {
  return settings?.agentStatusHooksEnabled !== false
}

function errorStatus(agent: AgentHookTarget, error: unknown): AgentHookInstallStatus {
  return {
    agent,
    state: 'error',
    configPath: '',
    managedHooksPresent: false,
    detail: error instanceof Error ? error.message : String(error)
  }
}

function skippedStatus(
  agent: AgentHookTarget,
  skipReason: NonNullable<AgentHookInstallStatus['skipReason']>,
  detail: string
): AgentHookInstallStatus {
  return {
    agent,
    state: 'skipped',
    configPath: '',
    managedHooksPresent: false,
    detail,
    skipReason
  }
}

function selectedInstallers(options: InstallOptions): readonly ManagedAgentHookInstaller[] {
  if (!options.agents) {
    return MANAGED_AGENT_HOOK_INSTALLERS
  }
  const allowed = new Set(options.agents)
  return MANAGED_AGENT_HOOK_INSTALLERS.filter(([agent]) => allowed.has(agent))
}

async function runInstaller(
  entry: ManagedAgentHookInstaller,
  onInstallError: InstallOptions['onInstallError']
): Promise<AgentHookInstallStatus> {
  const [agent, install] = entry
  try {
    return await install()
  } catch (error) {
    console.error(`[agent-hooks] Failed to install ${agent} managed hooks:`, error)
    try {
      onInstallError?.(agent, error)
    } catch (telemetryError) {
      console.error('[agent-hooks] Failed to record install-failure telemetry:', telemetryError)
    }
    return errorStatus(agent, error)
  }
}

// Why: each agent's install/remove used to be one uninterruptible sync block.
// Async reopens a read-modify-write window on the same hooks files, so keep
// every managed-hook mutation single-file — a startup install and a Settings
// toggle must not interleave their reads and writes.
let pendingMutation: Promise<unknown> = Promise.resolve()

function serializeMutation<T>(run: () => Promise<T>): Promise<T> {
  const result = pendingMutation.then(run, run)
  pendingMutation = result.then(
    () => undefined,
    () => undefined
  )
  return result
}

export function installManagedAgentHooks(
  settings: ManagedHookSettings = null,
  options: InstallOptions = {}
): Promise<AgentHookInstallStatus[]> {
  return serializeMutation(() => runInstallers(settings, options))
}

async function runInstallers(
  settings: ManagedHookSettings,
  options: InstallOptions
): Promise<AgentHookInstallStatus[]> {
  const installers = selectedInstallers(options)
  const disabled = new Set(normalizeDisabledTuiAgents(settings?.disabledTuiAgents))
  const enabledInstallers = installers.filter(([agent]) => !disabled.has(agent))
  const targets = enabledInstallers.flatMap(([agent]) => {
    const target = getManagedAgentHookTarget(agent)
    return target ? [target] : []
  })
  let presenceByAgent
  try {
    presenceByAgent = await detectLocalManagedAgentCliPresence(targets, settings, {
      shouldHydrateShellPath: options.shouldHydrateShellPath
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return installers.map(([agent]) =>
      disabled.has(agent)
        ? skippedStatus(agent, 'agent_disabled', 'Agent is disabled in Settings.')
        : skippedStatus(agent, 'cli_presence_unknown', detail)
    )
  }

  const results: AgentHookInstallStatus[] = []
  for (const entry of installers) {
    const [agent] = entry
    if (disabled.has(agent)) {
      results.push(skippedStatus(agent, 'agent_disabled', 'Agent is disabled in Settings.'))
      continue
    }
    if (options.shouldContinue && !options.shouldContinue(agent)) {
      results.push(
        skippedStatus(
          agent,
          'hooks_disabled',
          'Agent status hooks were disabled before install completed.'
        )
      )
      continue
    }
    const presence = presenceByAgent[agent]
    if (presence?.state !== 'found') {
      results.push(
        skippedStatus(
          agent,
          presence?.state === 'unknown' ? 'cli_presence_unknown' : 'cli_not_found',
          'CLI not found; managed hook install skipped.'
        )
      )
      continue
    }
    results.push(await runInstaller(entry, options.onInstallError))
  }
  return results
}

export function removeManagedAgentHooks(
  options: RemoveOptions = {}
): Promise<AgentHookInstallStatus[]> {
  return serializeMutation(() => runRemovers(options))
}

// Why: serial, not Promise.all — libuv's threadpool is 4 threads, so fanning 14
// agent configs out at once just starves every other async fs caller.
async function runRemovers(options: RemoveOptions): Promise<AgentHookInstallStatus[]> {
  const allowed = options.agents ? new Set(options.agents) : null
  const results: AgentHookInstallStatus[] = []
  for (const [agent, remove] of MANAGED_AGENT_HOOK_REMOVERS) {
    if (allowed !== null && !allowed.has(agent)) {
      continue
    }
    try {
      results.push(await remove())
    } catch (error) {
      results.push(errorStatus(agent, error))
    }
  }
  return results
}

export async function getManagedAgentHookStatuses(): Promise<AgentHookInstallStatus[]> {
  const results: AgentHookInstallStatus[] = []
  for (const [agent, getStatus] of MANAGED_AGENT_HOOK_STATUS_READERS) {
    try {
      results.push(await getStatus())
    } catch (error) {
      results.push(errorStatus(agent, error))
    }
  }
  return results
}

// Why: one critical section for the whole apply — the install pass and the
// disabled-agent sweep below must not have another toggle land between them.
export function applyAgentStatusHooksEnabled(
  enabled: boolean,
  settings: ManagedHookSettings = null,
  options: InstallOptions = {}
): Promise<AgentHookInstallStatus[]> {
  return serializeMutation(() => applyHooksEnabled(enabled, settings, options))
}

async function applyHooksEnabled(
  enabled: boolean,
  settings: ManagedHookSettings,
  options: InstallOptions
): Promise<AgentHookInstallStatus[]> {
  if (!enabled) {
    return await runRemovers({})
  }
  const disabled = normalizeDisabledTuiAgents(settings?.disabledTuiAgents).filter(
    isManagedAgentHookTarget
  )
  const installed = await runInstallers(settings, options)
  const disabledToRemove = options.shouldContinue
    ? disabled.filter((agent) => !options.shouldContinue?.(agent))
    : disabled
  if (disabledToRemove.length === 0) {
    return installed
  }
  const removed = new Map(
    (await runRemovers({ agents: disabledToRemove })).map((status) => [status.agent, status])
  )
  return installed.map((status) => removed.get(status.agent) ?? status)
}
