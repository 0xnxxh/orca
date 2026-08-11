import { join } from 'node:path'
import type { SkillInstallResult, SkillPlacementResult } from '../../shared/skill-install-contract'
import { readSkillInstallReceipt, writeSkillInstallReceipt } from './skill-install-provenance'
import {
  installLocalSkillPackage,
  previewLocalSkillPackage,
  type LocalSkillInstallInput
} from './skill-install-transaction'
import { reconcileSkillProviderPlacement } from './skill-placement-reconciliation'
import { resolveSkillProviderDestinations } from './skill-provider-destinations'
import { removeLocalSharedSkill } from './skill-remove-transaction'
import type { SkillInstallFilesystem } from './skill-install-filesystem'
import { verifySkillInstallDiscovery } from './skill-install-discovery-verification'
import type { SkillDiscoveryResult } from '../../shared/skills'

export type SkillInstallServiceInput = Omit<
  LocalSkillInstallInput,
  'destinationRoot' | 'stateDirectory' | 'scope'
> & {
  scope: 'global' | 'workspace'
  homeDirectory: string
  workspaceDirectory?: string
  orcaStateDirectory: string
  detectedProviders: readonly string[]
  filesystem?: SkillInstallFilesystem
  wslDistro?: string
  discover?: () => Promise<SkillDiscoveryResult>
  signal?: AbortSignal
}

export type SkillRemoveServiceInput = {
  operationId: string
  skillName: string
  scope: 'global' | 'workspace'
  homeDirectory: string
  workspaceDirectory?: string
  orcaStateDirectory: string
  detectedProviders: readonly string[]
  conflictResolution?: 'replace-and-discard-local' | 'cancel'
  filesystem?: SkillInstallFilesystem
}

function canonicalRoot(input: {
  scope: 'global' | 'workspace'
  homeDirectory: string
  workspaceDirectory?: string
}): string {
  const scopeRoot = input.scope === 'global' ? input.homeDirectory : input.workspaceDirectory
  if (!scopeRoot) {
    throw new Error('skill-install-workspace-required')
  }
  return join(scopeRoot, '.agents', 'skills')
}

function localInput(input: SkillInstallServiceInput): LocalSkillInstallInput {
  return {
    operationId: input.operationId,
    archivePath: input.archivePath,
    destinationRoot: canonicalRoot(input),
    stateDirectory: join(input.orcaStateDirectory, 'skill-installs'),
    scope: input.scope,
    destinationIdentity: input.destinationIdentity,
    hostIdentity: input.hostIdentity,
    expectedArchiveSha256: input.expectedArchiveSha256,
    expectedPackageDigest: input.expectedPackageDigest,
    expectedPackageId: input.expectedPackageId,
    expectedVersionId: input.expectedVersionId,
    conflictResolution: input.conflictResolution,
    filesystem: input.filesystem,
    wslDistro: input.wslDistro,
    signal: input.signal
  }
}

function canonicalPlacement(result: SkillInstallResult): SkillPlacementResult {
  return {
    provider: 'agent-skills',
    path: result.canonicalPath!,
    topology: 'canonical-copy',
    status: result.status === 'unchanged' ? 'unchanged' : 'installed'
  }
}

export async function installSharedSkill(
  input: SkillInstallServiceInput
): Promise<SkillInstallResult> {
  const request = localInput(input)
  const preview = await previewLocalSkillPackage(request)
  const previousReceipt = await readSkillInstallReceipt(
    request.stateDirectory,
    preview.canonicalPath
  )
  const result = await installLocalSkillPackage(request)
  if (
    !result.canonicalPath ||
    result.status === 'conflict' ||
    result.status === 'failed' ||
    result.status === 'cancelled'
  ) {
    return result
  }
  const placements: SkillPlacementResult[] = [canonicalPlacement(result)]
  const destinations = resolveSkillProviderDestinations({
    scope: input.scope,
    homeDirectory: input.homeDirectory,
    workspaceDirectory: input.workspaceDirectory,
    detectedProviders: input.detectedProviders
  })
  for (const destination of destinations) {
    if (destination.readsCanonicalRoot) {
      continue
    }
    if (input.signal?.aborted) {
      placements.push({
        provider: destination.provider,
        path: join(destination.rootPath, result.name),
        topology: 'independent-copy',
        status: 'skipped',
        errorCategory: 'skill-placement-cancelled',
        failure: {
          category: 'cancelled',
          code: 'skill-placement-cancelled',
          retryable: true
        }
      })
      continue
    }
    const placement = await reconcileSkillProviderPlacement({
      canonicalPath: result.canonicalPath,
      skillName: result.name,
      destination,
      previousReceipt,
      packageDigest: result.packageDigest,
      fileModes: preview.manifest.files,
      filesystem: input.filesystem
    })
    if (placement) {
      placements.push(placement)
    }
  }
  const receipt = await readSkillInstallReceipt(request.stateDirectory, result.canonicalPath)
  if (!receipt) {
    throw new Error('skill-install-receipt-missing')
  }
  await writeSkillInstallReceipt(request.stateDirectory, { ...receipt, placements })
  const incomplete = placements.some(
    (placement) => placement.status === 'failed' || placement.status === 'skipped'
  )
  return verifySkillInstallDiscovery({
    result: { ...result, status: incomplete ? 'partial' : result.status, placements },
    scope: input.scope,
    homeDirectory: input.homeDirectory,
    workspaceDirectory: input.workspaceDirectory,
    wslDistro: input.wslDistro,
    discover: input.discover
  })
}

export async function removeSharedSkill(
  input: SkillRemoveServiceInput
): Promise<SkillInstallResult> {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(input.skillName)) {
    throw new Error('skill-install-name-invalid')
  }
  const providerDestinations = resolveSkillProviderDestinations({
    scope: input.scope,
    homeDirectory: input.homeDirectory,
    workspaceDirectory: input.workspaceDirectory,
    detectedProviders: input.detectedProviders
  })
  return removeLocalSharedSkill({
    operationId: input.operationId,
    canonicalPath: join(canonicalRoot(input), input.skillName),
    stateDirectory: join(input.orcaStateDirectory, 'skill-installs'),
    allowedProviderRoots: providerDestinations
      .filter((destination) => !destination.readsCanonicalRoot)
      .map((destination) => destination.rootPath),
    conflictResolution: input.conflictResolution,
    filesystem: input.filesystem
  })
}
