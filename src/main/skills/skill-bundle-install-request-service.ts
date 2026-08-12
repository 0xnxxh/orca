import { isAbsolute, join } from 'node:path'
import {
  SkillBundleInstallRequestSchema,
  type SkillBundleInstallRequest,
  type SkillBundleInstallResult,
  type SkillBundlePackageIdentity
} from '../../shared/skill-bundle-install-contract'
import { resolveSkillInstallDestination } from './skill-install-destinations'
import type { SkillInstallDestinationAuthority } from './skill-install-destinations'
import { installSkillBundle } from './skill-bundle-install-service'
import { downloadSkillPackageGrant } from './skill-package-download'
import { detectSkillProvidersInWsl } from './skill-wsl-provider-detection'
import { createWslSkillInstallFilesystem } from './skill-wsl-install-filesystem'

type StagedSkillBundle = { archivePath: string; cleanup(): Promise<void> }

export type SkillBundleInstallRequestDependencies = {
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
    identity: SkillBundlePackageIdentity
  ) => Promise<StagedSkillBundle>
}

async function resolveIngress(
  request: SkillBundleInstallRequest,
  dependencies: SkillBundleInstallRequestDependencies
): Promise<StagedSkillBundle> {
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
      throw new Error('skill-bundle-staged-upload-unsupported')
    }
    return dependencies.resolveStagedUpload(request.ingress.uploadId, request.package)
  }
  if (!dependencies.allowTrustedLocalFile || !isAbsolute(request.ingress.path)) {
    throw new Error('skill-install-local-ingress-rejected')
  }
  return { archivePath: request.ingress.path, cleanup: async () => undefined }
}

export async function executeSkillBundleInstallRequest(
  input: unknown,
  dependencies: SkillBundleInstallRequestDependencies
): Promise<SkillBundleInstallResult> {
  const request = SkillBundleInstallRequestSchema.parse(input)
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
    return await installSkillBundle({
      operationId: request.operationId,
      archivePath: ingress.archivePath,
      packageId: request.package.packageId,
      versionId: request.package.versionId,
      bundleDigest: request.package.bundleDigest,
      selectedSkillIds: request.selectedSkillIds,
      conflictDecisions: new Map(
        request.conflictDecisions.map((decision) => [decision.skillId, decision.resolution])
      ),
      scope: destination.scope,
      homeDirectory: destination.homeDirectory,
      workspaceDirectory: destination.workspaceDirectory,
      orcaStateDirectory: dependencies.stateDirectory,
      detectedProviders,
      destinationIdentity: destination.destinationIdentity,
      hostIdentity: dependencies.authority.environmentId,
      expectedArchiveSha256: request.package.archiveSha256,
      filesystem,
      wslDistro: destination.wslDistro,
      signal: dependencies.signal
    })
  } finally {
    await ingress.cleanup()
  }
}
