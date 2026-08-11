import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'
import { z } from 'zod'
import {
  SKILL_INSTALL_CAPABILITY,
  SKILL_INSTALL_UPDATE_REQUIRED_MESSAGE
} from '../../shared/skill-install-capability'
import {
  SkillInstallDestinationSchema,
  type SkillInstallRequest
} from '../../shared/skill-install-contract'
import { SkillDiscoveryTargetSchema, type SkillDiscoveryResult } from '../../shared/skills'
import type { SkillCloudDownloadGrant } from '../../shared/skill-cloud-contract'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { installSkillOnRemoteRuntime } from '../skills/skill-remote-install-service'
import { classifySkillCloudInstallTarget } from '../skills/skill-cloud-install-target'
import { SkillSharePreparationService } from '../skills/skill-share-preparation-service'
import { skillInstallFailureFromError } from '../skills/skill-install-operation-error'
import {
  callRuntimeEnvironment,
  getRuntimeEnvironmentStatus
} from './runtime-environment-transport-routing'
import { registerSkillInstallManagementIpcHandlers } from './skill-install-management-ipc-handlers'

const environmentIdSchema = z.string().min(1).max(128)

const sharePrepareSchema = z
  .object({
    skillId: z.string().min(1).max(4096),
    target: SkillDiscoveryTargetSchema.optional(),
    packageId: z.string().min(1).max(128).optional()
  })
  .strict()

const sharePublishSchema = z
  .object({
    preparationId: z.string().uuid(),
    releaseNotes: z.string().max(10_000),
    userIds: z.array(z.string().min(1).max(128)).max(100),
    shareWithOrganization: z.boolean()
  })
  .strict()

const installDestinationFields = {
  operationId: z.string().min(1).max(128).optional(),
  environmentId: environmentIdSchema.optional(),
  destination: SkillInstallDestinationSchema,
  conflictResolution: z
    .enum(['replace-unmodified', 'replace-and-discard-local', 'cancel'])
    .optional()
} as const

const shareInstallSchema = z
  .object({
    shareId: z.string().min(1).max(128),
    versionId: z.string().min(1).max(128).optional(),
    ...installDestinationFields
  })
  .strict()

const packageVersionInstallSchema = z
  .object({
    packageId: z.string().min(1).max(128),
    versionId: z.string().min(1).max(128),
    ...installDestinationFields
  })
  .strict()

const replaceAccessSchema = z
  .object({
    packageId: z.string().min(1).max(128),
    userIds: z.array(z.string().min(1).max(128)).max(100),
    shareWithOrganization: z.boolean()
  })
  .strict()

const packageVersionSchema = z
  .object({
    packageId: z.string().min(1).max(128),
    versionId: z.string().min(1).max(128)
  })
  .strict()

async function installGrant(
  runtime: OrcaRuntimeService,
  grant: SkillCloudDownloadGrant,
  input: z.infer<typeof shareInstallSchema> | z.infer<typeof packageVersionInstallSchema>
) {
  const request: SkillInstallRequest = {
    operationId: input.operationId ?? randomUUID(),
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
        requireHttps: app.isPackaged
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

function registerSharingHandlers(
  runtime: OrcaRuntimeService,
  discover: (target?: z.infer<typeof SkillDiscoveryTargetSchema>) => Promise<SkillDiscoveryResult>
): void {
  const preparations = new SkillSharePreparationService(
    join(app.getPath('userData'), 'skill-share-preparations'),
    { publish: (request) => runtime.publishSkillPackage(request) }
  )
  ipcMain.handle('skills:prepareShare', async (_event, value: unknown) => {
    const input = sharePrepareSchema.parse(value)
    const result = await discover(input.target)
    const skill = result.skills.find((candidate) => candidate.id === input.skillId)
    if (!skill) {
      throw new Error('skill-share-source-not-found')
    }
    return preparations.prepare({
      sourceDirectory: skill.directoryPath,
      packageId: input.packageId
    })
  })
  ipcMain.handle('skills:publishShare', async (_event, value: unknown) => {
    const input = sharePublishSchema.parse(value)
    return preparations.publish(input, (progress) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
          window.webContents.send('skills:shareProgress', progress)
        }
      }
    })
  })
  ipcMain.handle('skills:cancelShare', (_event, id: unknown) => {
    preparations.cancel(z.string().uuid().parse(id))
  })
  ipcMain.handle('skills:releaseShare', async (_event, id: unknown) => {
    await preparations.release(z.string().uuid().parse(id))
  })
}

function registerCloudInstallHandlers(runtime: OrcaRuntimeService): void {
  ipcMain.handle('skills:resolveShare', (_event, shareId: unknown) =>
    runtime.resolveSkillShare(z.string().min(1).max(128).parse(shareId), {})
  )
  ipcMain.handle('skills:createDownloadGrant', (_event, shareId: unknown) =>
    runtime.createSkillDownloadGrant(z.string().min(1).max(128).parse(shareId), {})
  )
  ipcMain.handle('skills:installShare', async (_event, value: unknown) => {
    const input = shareInstallSchema.parse(value)
    const installTarget = await classifySkillCloudInstallTarget(runtime, input)
    const grant = await runtime.createSkillDownloadGrant(input.shareId, {
      versionId: input.versionId,
      installTarget
    })
    return grant.status === 'ok' ? installGrant(runtime, grant.value, input) : grant
  })
  ipcMain.handle('skills:installPackageVersion', async (_event, value: unknown) => {
    const input = packageVersionInstallSchema.parse(value)
    const installTarget = await classifySkillCloudInstallTarget(runtime, input)
    const grant = await runtime.createSkillPackageVersionDownloadGrant(
      input.packageId,
      input.versionId,
      { installTarget }
    )
    return grant.status === 'ok' ? installGrant(runtime, grant.value, input) : grant
  })
  ipcMain.handle('skills:cancelInstall', async (_event, value: unknown) => {
    const input = z
      .object({
        operationId: z.string().min(1).max(128),
        environmentId: environmentIdSchema.optional()
      })
      .strict()
      .parse(value)
    if (!input.environmentId || input.environmentId.startsWith('ssh:')) {
      return { cancelled: runtime.cancelSharedSkillInstall(input.operationId) }
    }
    const response = await callRuntimeEnvironment(
      app.getPath('userData'),
      input.environmentId,
      'skills.cancelInstall',
      { operationId: input.operationId },
      15_000
    )
    return response.ok === true && response.result && typeof response.result === 'object'
      ? { cancelled: (response.result as { cancelled?: unknown }).cancelled === true }
      : { cancelled: false }
  })
  ipcMain.handle('skills:getPackage', (_event, packageId: unknown) =>
    runtime.getSkillPackage(z.string().min(1).max(128).parse(packageId), {})
  )
  ipcMain.handle('skills:replacePackageAccess', (_event, value: unknown) => {
    const input = replaceAccessSchema.parse(value)
    return runtime.replaceSkillPackageAccess(
      input.packageId,
      {
        userIds: input.userIds,
        shareWithOrganization: input.shareWithOrganization
      },
      {}
    )
  })
  ipcMain.handle('skills:revokeShare', (_event, shareId: unknown) =>
    runtime.revokeSkillShare(z.string().min(1).max(128).parse(shareId), {})
  )
  ipcMain.handle('skills:deletePackageVersion', (_event, value: unknown) => {
    const input = packageVersionSchema.parse(value)
    return runtime.deleteSkillPackageVersion(input.packageId, input.versionId, {})
  })
  ipcMain.handle('skills:deletePackage', (_event, packageId: unknown) =>
    runtime.deleteSkillPackage(z.string().min(1).max(128).parse(packageId), {})
  )
}

export function registerSkillCloudIpcHandlers(
  runtime: OrcaRuntimeService,
  discover: (target?: z.infer<typeof SkillDiscoveryTargetSchema>) => Promise<SkillDiscoveryResult>
): void {
  registerSharingHandlers(runtime, discover)
  registerCloudInstallHandlers(runtime)
  registerSkillInstallManagementIpcHandlers(runtime)
}
