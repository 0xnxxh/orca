import { isAbsolute, join } from 'node:path'
import {
  SkillInstallRequestSchema,
  type SkillInstallRequest,
  type SkillInstallResult
} from '../../shared/skill-install-contract'
import {
  resolveSkillInstallDestination,
  type SkillInstallDestinationAuthority
} from './skill-install-destinations'
import { installSharedSkill } from './skill-install-service'
import { downloadSkillPackageGrant } from './skill-package-download'
import { detectSkillProvidersInWsl } from './skill-wsl-provider-detection'
import { createWslSkillInstallFilesystem } from './skill-wsl-install-filesystem'

type StagedSkillPackage = {
  archivePath: string
  cleanup(): Promise<void>
}

export type SkillInstallRequestDependencies = {
  authority: SkillInstallDestinationAuthority
  stateDirectory: string
  allowedDownloadOrigins: readonly string[]
  requireHttps: boolean
  allowTrustedLocalFile?: boolean
  signal?: AbortSignal
  fetcher?: typeof fetch
  detectProviders: () => Promise<readonly string[]>
  resolveStagedUpload?: (
    uploadId: string,
    identity: SkillInstallRequest['package']
  ) => Promise<StagedSkillPackage>
}

async function resolveIngress(
  request: SkillInstallRequest,
  dependencies: SkillInstallRequestDependencies
): Promise<StagedSkillPackage> {
  if (request.ingress.kind === 'download-grant') {
    return downloadSkillPackageGrant({
      url: request.ingress.url,
      expiresAt: request.ingress.expiresAt,
      expectedArchiveSha256: request.package.archiveSha256,
      expectedCompressedBytes: request.package.compressedBytes,
      temporaryRoot: join(dependencies.stateDirectory, 'skill-installs', 'downloads'),
      allowedOrigins: dependencies.allowedDownloadOrigins,
      requireHttps: dependencies.requireHttps,
      signal: dependencies.signal,
      fetcher: dependencies.fetcher
    })
  }
  if (request.ingress.kind === 'staged-upload') {
    if (!dependencies.resolveStagedUpload) {
      throw new Error('skill-install-staged-upload-unsupported')
    }
    return dependencies.resolveStagedUpload(request.ingress.uploadId, request.package)
  }
  if (!dependencies.allowTrustedLocalFile || !isAbsolute(request.ingress.path)) {
    throw new Error('skill-install-local-ingress-rejected')
  }
  return { archivePath: request.ingress.path, cleanup: async () => undefined }
}

export async function executeSkillInstallRequest(
  input: unknown,
  dependencies: SkillInstallRequestDependencies
): Promise<SkillInstallResult> {
  const request = SkillInstallRequestSchema.parse(input)
  const destination = await resolveSkillInstallDestination(
    request.destination,
    dependencies.authority
  )
  const ingress = await resolveIngress(request, dependencies)
  try {
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
    return await installSharedSkill({
      operationId: request.operationId,
      archivePath: ingress.archivePath,
      scope: destination.scope,
      homeDirectory: destination.homeDirectory,
      workspaceDirectory: destination.workspaceDirectory,
      orcaStateDirectory: dependencies.stateDirectory,
      detectedProviders,
      destinationIdentity: destination.destinationIdentity,
      hostIdentity: dependencies.authority.environmentId,
      expectedArchiveSha256: request.package.archiveSha256,
      expectedPackageDigest: request.package.packageDigest,
      expectedPackageId: request.package.packageId,
      expectedVersionId: request.package.versionId,
      conflictResolution: request.conflictResolution,
      filesystem,
      wslDistro: destination.wslDistro
    })
  } finally {
    await ingress.cleanup()
  }
}
