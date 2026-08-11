import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  SkillInstallPreview,
  SkillInstallPreviewRequest,
  SkillInstallResult,
  SkillRemoveRequest
} from '../../shared/skill-install-contract'
import type { SkillInstallDestinationAuthority } from './skill-install-destinations'
import { resolveSkillInstallDestination } from './skill-install-destinations'
import { inspectSkillCanonicalState } from './skill-install-planner'
import { readSkillInstallReceipt } from './skill-install-provenance'
import { resolveSkillProviderDestinations } from './skill-provider-destinations'
import { removeLocalSharedSkill } from './skill-remove-transaction'
import { detectSkillProvidersInWsl } from './skill-wsl-provider-detection'
import { createWslSkillInstallFilesystem } from './skill-wsl-install-filesystem'

type ManagementDependencies = {
  authority: SkillInstallDestinationAuthority
  stateDirectory: string
  detectProviders(): Promise<readonly string[]>
}

function canonicalPath(
  destination: Awaited<ReturnType<typeof resolveSkillInstallDestination>>,
  name: string
): string {
  return join(
    destination.scope === 'global' ? destination.homeDirectory : destination.workspaceDirectory!,
    '.agents',
    'skills',
    name
  )
}

export async function previewSharedSkillInstall(
  request: SkillInstallPreviewRequest,
  dependencies: ManagementDependencies
): Promise<SkillInstallPreview> {
  const destination = await resolveSkillInstallDestination(
    request.destination,
    dependencies.authority
  )
  const path = canonicalPath(destination, request.name)
  const filesystem = destination.wslDistro
    ? createWslSkillInstallFilesystem({
        distro: destination.wslDistro,
        homeDirectory: destination.homeDirectory,
        workspaceDirectory: destination.workspaceDirectory
      })
    : undefined
  const installStateDirectory = join(dependencies.stateDirectory, 'skill-installs')
  const [receipt, detectedProviders] = await Promise.all([
    readSkillInstallReceipt(installStateDirectory, path),
    destination.wslDistro
      ? detectSkillProvidersInWsl(destination.wslDistro)
      : dependencies.detectProviders()
  ])
  const current = await inspectSkillCanonicalState({
    canonicalPath: path,
    receipt,
    manifest: {
      schemaVersion: 1,
      packageId: request.package.packageId,
      versionId: request.package.versionId,
      name: request.name,
      description: '',
      createdAt: new Date(0).toISOString(),
      files: [],
      packageDigest: request.package.packageDigest
    },
    filesystem
  })
  const providers = resolveSkillProviderDestinations({
    scope: destination.scope,
    homeDirectory: destination.homeDirectory,
    workspaceDirectory: destination.workspaceDirectory,
    detectedProviders
  })
  return {
    name: request.name,
    packageDigest: request.package.packageDigest,
    destinationIdentity: destination.destinationIdentity,
    currentState: current.kind,
    providers: await Promise.all(
      providers.map(async (provider) => {
        const placementPath = join(provider.rootPath, request.name)
        const stat = await lstat(placementPath).catch(() => null)
        return {
          provider: provider.provider,
          topology: provider.readsCanonicalRoot
            ? ('canonical-copy' as const)
            : ('provider-alias' as const),
          state: provider.readsCanonicalRoot || !stat ? ('ready' as const) : ('conflict' as const)
        }
      })
    )
  }
}

export async function removeSharedSkillInstall(
  request: SkillRemoveRequest,
  dependencies: ManagementDependencies
): Promise<SkillInstallResult> {
  const destination = await resolveSkillInstallDestination(
    request.destination,
    dependencies.authority
  )
  const detectedProviders = destination.wslDistro
    ? await detectSkillProvidersInWsl(destination.wslDistro)
    : await dependencies.detectProviders()
  const filesystem = destination.wslDistro
    ? createWslSkillInstallFilesystem({
        distro: destination.wslDistro,
        homeDirectory: destination.homeDirectory,
        workspaceDirectory: destination.workspaceDirectory
      })
    : undefined
  const providerRoots = resolveSkillProviderDestinations({
    scope: destination.scope,
    homeDirectory: destination.homeDirectory,
    workspaceDirectory: destination.workspaceDirectory,
    detectedProviders
  }).map((provider) => provider.rootPath)
  return removeLocalSharedSkill({
    operationId: request.operationId,
    canonicalPath: canonicalPath(destination, request.name),
    stateDirectory: join(dependencies.stateDirectory, 'skill-installs'),
    allowedProviderRoots: providerRoots,
    conflictResolution: request.conflictResolution,
    filesystem
  })
}
