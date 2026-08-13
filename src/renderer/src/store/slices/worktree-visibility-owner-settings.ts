import { callRuntimeRpc, getActiveRuntimeTarget } from '@/runtime/runtime-rpc-client'
import {
  LOCAL_EXECUTION_HOST_ID,
  toRuntimeExecutionHostId,
  type ExecutionHostId
} from '../../../../shared/execution-host'
import type { GlobalSettings, WorktreeVisibilityDefaults } from '../../../../shared/types'

export type WorktreeVisibilityDefaultsByHost = Partial<
  Record<ExecutionHostId, WorktreeVisibilityDefaults | null>
>

export async function readRuntimeWorktreeVisibilityDefaults(
  environmentId: string
): Promise<WorktreeVisibilityDefaults | null | undefined> {
  try {
    const result = await callRuntimeRpc<{ settings: Partial<GlobalSettings> }>(
      { kind: 'environment', environmentId },
      'settings.get',
      undefined,
      { timeoutMs: 15_000, reuseRecentCompatibilityFailure: true }
    )
    const external = result.settings.worktreeVisibilityDefaults?.external
    return external === 'hide' || external === 'show' ? { external } : null
  } catch {
    return undefined
  }
}

export async function hydrateOwnerWorktreeVisibilityDefaults(
  settings: GlobalSettings,
  defaultsByHost: WorktreeVisibilityDefaultsByHost
): Promise<{
  settings: GlobalSettings
  defaultsByHost: WorktreeVisibilityDefaultsByHost
  supportedRuntimeEnvironmentId: string | null
}> {
  const target = getActiveRuntimeTarget(settings)
  if (target.kind !== 'environment') {
    return {
      settings,
      supportedRuntimeEnvironmentId: null,
      defaultsByHost: {
        ...defaultsByHost,
        [LOCAL_EXECUTION_HOST_ID]: settings.worktreeVisibilityDefaults ?? { external: 'hide' }
      }
    }
  }
  const hostId = toRuntimeExecutionHostId(target.environmentId)
  const localDefaults =
    defaultsByHost[LOCAL_EXECUTION_HOST_ID] ?? settings.worktreeVisibilityDefaults
  const ownerDefaultsByHost = localDefaults
    ? { ...defaultsByHost, [LOCAL_EXECUTION_HOST_ID]: localDefaults }
    : defaultsByHost
  const defaults = await readRuntimeWorktreeVisibilityDefaults(target.environmentId)
  if (defaults) {
    return {
      settings: { ...settings, worktreeVisibilityDefaults: defaults },
      defaultsByHost: { ...ownerDefaultsByHost, [hostId]: defaults },
      supportedRuntimeEnvironmentId: target.environmentId
    }
  }
  if (defaults === undefined) {
    const cached = ownerDefaultsByHost[hostId]
    if (cached) {
      return {
        settings: { ...settings, worktreeVisibilityDefaults: cached },
        defaultsByHost: ownerDefaultsByHost,
        supportedRuntimeEnvironmentId: target.environmentId
      }
    }
    const { worktreeVisibilityDefaults: _unavailable, ...settingsWithoutDefaults } = settings
    return {
      settings: settingsWithoutDefaults as GlobalSettings,
      defaultsByHost: ownerDefaultsByHost,
      supportedRuntimeEnvironmentId: null
    }
  }
  const { worktreeVisibilityDefaults: _unsupported, ...settingsWithoutDefaults } = settings
  return {
    settings: settingsWithoutDefaults as GlobalSettings,
    defaultsByHost: { ...ownerDefaultsByHost, [hostId]: null },
    supportedRuntimeEnvironmentId: null
  }
}
