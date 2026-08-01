// Renderer-supplied IPC payloads for the orcaProfiles channels are untrusted;
// narrow every field at the boundary before it reaches the profile store.
import type {
  CreateCloudLinkedOrcaProfileArgs,
  FindOrcaProfileProjectsByPathArgs,
  SelectOrcaProfileOrgArgs,
  SwitchOrcaProfileArgs,
  TransferOrcaProfileProjectArgs
} from '../../shared/orca-profiles'
import { normalizeExecutionHostId } from '../../shared/execution-host'

export function profileIdFromArgs(args: unknown): string {
  if (
    !args ||
    typeof args !== 'object' ||
    typeof (args as SwitchOrcaProfileArgs).profileId !== 'string'
  ) {
    throw new Error('invalid_orca_profile_id')
  }
  const profileId = (args as SwitchOrcaProfileArgs).profileId.trim()
  if (!profileId) {
    throw new Error('invalid_orca_profile_id')
  }
  return profileId
}

export function transferProjectArgsFromUnknown(args: unknown): TransferOrcaProfileProjectArgs {
  if (!args || typeof args !== 'object') {
    throw new Error('invalid_orca_profile_project_transfer')
  }
  const candidate = args as TransferOrcaProfileProjectArgs
  const sourceProfileId = candidate.sourceProfileId?.trim()
  const targetProfileId = candidate.targetProfileId?.trim()
  const repoId = candidate.repoId?.trim()
  const mode = candidate.mode
  if (!sourceProfileId || !targetProfileId || !repoId || (mode !== 'move' && mode !== 'copy')) {
    throw new Error('invalid_orca_profile_project_transfer')
  }
  return {
    sourceProfileId,
    targetProfileId,
    repoId,
    mode
  }
}

export function findProjectsByPathArgsFromUnknown(
  args: unknown
): FindOrcaProfileProjectsByPathArgs {
  if (!args || typeof args !== 'object') {
    throw new Error('invalid_orca_profile_project_path')
  }
  const candidate = args as FindOrcaProfileProjectsByPathArgs
  const path = typeof candidate.path === 'string' ? candidate.path.trim() : ''
  if (!path) {
    throw new Error('invalid_orca_profile_project_path')
  }
  let executionHostId: FindOrcaProfileProjectsByPathArgs['executionHostId'] = null
  if (candidate.executionHostId !== null && candidate.executionHostId !== undefined) {
    if (typeof candidate.executionHostId !== 'string') {
      throw new Error('invalid_orca_profile_project_path')
    }
    executionHostId = normalizeExecutionHostId(candidate.executionHostId)
    if (!executionHostId) {
      throw new Error('invalid_orca_profile_project_path')
    }
  }
  return {
    path,
    connectionId:
      typeof candidate.connectionId === 'string' ? candidate.connectionId.trim() || null : null,
    executionHostId,
    excludeProfileId:
      typeof candidate.excludeProfileId === 'string'
        ? candidate.excludeProfileId.trim() || null
        : null
  }
}

export function orgIdFromUnknown(args: unknown): string {
  if (!args || typeof args !== 'object') {
    throw new Error('invalid_orca_profile_org_selection')
  }
  const orgId = (args as SelectOrcaProfileOrgArgs).orgId?.trim()
  if (!orgId) {
    throw new Error('invalid_orca_profile_org_selection')
  }
  return orgId
}

export function createCloudLinkedProfileArgsFromUnknown(
  args: unknown
): CreateCloudLinkedOrcaProfileArgs {
  if (!args || typeof args !== 'object') {
    return {}
  }
  const candidate = args as CreateCloudLinkedOrcaProfileArgs
  const orgId = typeof candidate.orgId === 'string' ? candidate.orgId.trim() : undefined
  const name = typeof candidate.name === 'string' ? candidate.name.trim() : undefined
  return {
    ...(orgId ? { orgId } : {}),
    ...(name ? { name } : {})
  }
}
