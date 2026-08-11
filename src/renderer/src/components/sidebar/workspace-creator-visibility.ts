import type { RuntimeStatus } from '../../../../shared/runtime-types'
import type { PublicKnownRuntimeEnvironment } from '../../../../shared/runtime-environments'
import type { Worktree } from '../../../../shared/types'
import { normalizeWorkspaceCreatorProvenance } from '../../../../shared/workspace-creator-provenance'

type RuntimeStatusEntry = { status: RuntimeStatus | null }

export function getPairedDeviceIdsByEnvironment(
  environments: readonly PublicKnownRuntimeEnvironment[],
  statuses: ReadonlyMap<string, RuntimeStatusEntry>
): ReadonlyMap<string, string> {
  const result = new Map<string, string>()
  for (const environment of environments) {
    const deviceId =
      environment.pairedDeviceId ?? statuses.get(environment.id)?.status?.pairedDeviceId
    if (deviceId) {
      result.set(environment.id, deviceId)
    }
  }
  return result
}

export function isWorkspaceFromOtherDevice(
  worktree: Worktree,
  pairedDeviceIdsByEnvironment: ReadonlyMap<string, string>
): boolean {
  const creator = normalizeWorkspaceCreatorProvenance(worktree.creatorProvenance)
  if (!creator) {
    return false
  }
  const environmentId = worktree.runtimeOwnerEnvironmentId
  if (!environmentId) {
    return creator.kind !== 'host'
  }
  const pairedDeviceId = pairedDeviceIdsByEnvironment.get(environmentId)
  if (!pairedDeviceId) {
    return false
  }
  return creator.kind !== 'paired-device' || creator.deviceId !== pairedDeviceId
}
