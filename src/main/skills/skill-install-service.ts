import { join } from 'node:path'
import type { SkillInstallResult, SkillPlacementResult } from '../../shared/skill-install-contract'
import { readSkillInstallReceipt, writeSkillInstallReceipt } from './skill-install-provenance'
import {
  installLocalExtractedSkillPackage,
  installLocalSkillPackage,
  type LocalExtractedSkillPackage,
  type LocalSkillInstallInput,
  previewLocalSkillPackage
} from './skill-install-transaction'
import { reconcileSkillProviderPlacement } from './skill-placement-reconciliation'
import { resolveSkillProviderDestinations } from './skill-provider-destinations'
import { removeLocalSharedSkill } from './skill-remove-transaction'
import type { SkillInstallFilesystem } from './skill-install-filesystem'
import { verifySkillInstallDiscovery } from './skill-install-discovery-verification'
import type { SkillDiscoveryResult } from '../../shared/skills'
import type { SkillPackageManifestV1 } from '../../shared/skill-package-manifest'

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

export function skillInstallLocalInput(input: SkillInstallServiceInput): LocalSkillInstallInput {
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
    sourceBundleDigest: input.sourceBundleDigest,
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
  const request = skillInstallLocalInput(input)
  const preview = await previewLocalSkillPackage(request)
  const previousReceipt = await readSkillInstallReceipt(
    request.stateDirectory,
    preview.canonicalPath
  )
  const result = await installLocalSkillPackage(request)
  return completeSharedSkillInstall({
    input,
    request,
    manifest: preview.manifest,
    previousReceipt,
    result
  })
}

export async function installSharedExtractedSkill(
  input: SkillInstallServiceInput,
  extracted: LocalExtractedSkillPackage
): Promise<SkillInstallResult> {
  const request = skillInstallLocalInput(input)
  const canonicalPath = join(request.destinationRoot, extracted.manifest.name)
  const previousReceipt = await readSkillInstallReceipt(request.stateDirectory, canonicalPath)
  const result = await installLocalExtractedSkillPackage(request, extracted)
  return completeSharedSkillInstall({
    input,
    request,
    manifest: extracted.manifest,
    previousReceipt,
    result
  })
}

async function completeSharedSkillInstall(input: {
  input: SkillInstallServiceInput
  request: LocalSkillInstallInput
  manifest: SkillPackageManifestV1
  previousReceipt: Awaited<ReturnType<typeof readSkillInstallReceipt>>
  result: SkillInstallResult
}): Promise<SkillInstallResult> {
  const { result } = input
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
    scope: input.input.scope,
    homeDirectory: input.input.homeDirectory,
    workspaceDirectory: input.input.workspaceDirectory,
    detectedProviders: input.input.detectedProviders
  })
  for (const destination of destinations) {
    if (destination.readsCanonicalRoot) {
      continue
    }
    if (input.input.signal?.aborted) {
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
      previousReceipt: input.previousReceipt,
      packageDigest: result.packageDigest,
      fileModes: input.manifest.files,
      filesystem: input.input.filesystem,
      ...(input.input.wslDistro ? { targetPlatform: 'linux' as const } : {})
    })
    if (placement) {
      placements.push(placement)
    }
  }
  const receipt = await readSkillInstallReceipt(input.request.stateDirectory, result.canonicalPath)
  if (!receipt) {
    throw new Error('skill-install-receipt-missing')
  }
  await writeSkillInstallReceipt(input.request.stateDirectory, { ...receipt, placements })
  const incomplete = placements.some(
    (placement) => placement.status === 'failed' || placement.status === 'skipped'
  )
  return verifySkillInstallDiscovery({
    result: { ...result, status: incomplete ? 'partial' : result.status, placements },
    scope: input.input.scope,
    homeDirectory: input.input.homeDirectory,
    workspaceDirectory: input.input.workspaceDirectory,
    wslDistro: input.input.wslDistro,
    discover: input.input.discover
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
