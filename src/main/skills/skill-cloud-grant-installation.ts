import { app } from 'electron'
import {
  SKILL_INSTALL_CAPABILITY,
  SKILL_INSTALL_UPDATE_REQUIRED_MESSAGE
} from '../../shared/skill-install-capability'
import type {
  SkillInstallDestination,
  SkillInstallRequest
} from '../../shared/skill-install-contract'
import type { SkillCloudDownloadGrant } from '../../shared/skill-cloud-contract'
import { getRuntimeEnvironmentStatus } from '../ipc/runtime-environment-transport-routing'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { skillInstallFailureFromError } from './skill-install-operation-error'
import { installSkillOnRemoteRuntime } from './skill-remote-install-service'

export type SkillCloudGrantInstallInput = {
  operationId: string
  environmentId?: string
  destination: SkillInstallDestination
  conflictResolution?: 'replace-unmodified' | 'replace-and-discard-local' | 'cancel'
}

export async function installSkillCloudGrant(
  runtime: OrcaRuntimeService,
  grant: SkillCloudDownloadGrant,
  input: SkillCloudGrantInstallInput,
  signal?: AbortSignal
) {
  const request: SkillInstallRequest = {
    operationId: input.operationId,
    package: {
      packageId: grant.version.packageId,
      versionId: grant.version.versionId,
      packageDigest: grant.version.packageDigest,
      archiveSha256: grant.version.archiveSha256,
      compressedBytes: grant.version.compressedBytes
    },
    ingress: {
      kind: 'download-grant',
      url: grant.grant.url,
      expiresAt: grant.grant.expiresAt
    },
    destination: input.destination,
    conflictResolution: input.conflictResolution
  }
  try {
    if (!input.environmentId) {
      return { status: 'ok' as const, value: await runtime.installSharedSkillRequest(request) }
    }
    const userDataPath = app.getPath('userData')
    const status = await getRuntimeEnvironmentStatus(userDataPath, input.environmentId, 15_000)
    if (
      status.ok !== true ||
      status.result.capabilities?.includes(SKILL_INSTALL_CAPABILITY) !== true
    ) {
      return { status: 'unsupported' as const, message: SKILL_INSTALL_UPDATE_REQUIRED_MESSAGE }
    }
    return {
      status: 'ok' as const,
      value: await installSkillOnRemoteRuntime({
        userDataPath,
        environmentId: input.environmentId,
        request,
        capabilities: status.result.capabilities ?? [],
        requireHttps: app.isPackaged,
        signal
      })
    }
  } catch (error) {
    const failure = skillInstallFailureFromError(error)
    if (!failure) {
      throw error
    }
    return {
      status: 'ok' as const,
      value: {
        operationId: request.operationId,
        status: failure.category === 'cancelled' ? ('cancelled' as const) : ('failed' as const),
        name: grant.version.name,
        packageDigest: request.package.packageDigest,
        placements: [],
        errorCategory: failure.code,
        failure
      }
    }
  }
}
