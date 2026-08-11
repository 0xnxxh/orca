import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'
import { z } from 'zod'
import {
  SKILL_INSTALL_CAPABILITY,
  SKILL_INSTALL_UPDATE_REQUIRED_MESSAGE
} from '../../shared/skill-install-capability'
import {
  ManagedSkillInstallListSchema,
  SkillInstallDestinationSchema,
  SkillInstallPreviewSchema,
  SkillInstallResultSchema,
  SkillPackageIdentitySchema,
  type SkillInstallRequest
} from '../../shared/skill-install-contract'
import { SkillDiscoveryTargetSchema, type SkillDiscoveryResult } from '../../shared/skills'
import type { SkillCloudDownloadGrant } from '../../shared/skill-cloud-contract'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { installSkillOnRemoteRuntime } from '../skills/skill-remote-install-service'
import { classifySkillCloudInstallTarget } from '../skills/skill-cloud-install-target'
import { SkillSharePreparationService } from '../skills/skill-share-preparation-service'
import { supportsSkillRuntimeManagement } from '../skills/skill-runtime-capability'
import { listWslDistrosAsync } from '../wsl'
import {
  callRuntimeEnvironment,
  getRuntimeEnvironmentStatus
} from './runtime-environment-transport-routing'

const environmentIdSchema = z.string().min(1).max(128)
const skillNameSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/)

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

const installPreviewSchema = z
  .object({
    environmentId: environmentIdSchema.optional(),
    package: SkillPackageIdentitySchema,
    name: skillNameSchema,
    destination: SkillInstallDestinationSchema
  })
  .strict()

const removeSchema = z
  .object({
    environmentId: environmentIdSchema.optional(),
    name: skillNameSchema,
    destination: SkillInstallDestinationSchema,
    conflictResolution: z.enum(['replace-and-discard-local', 'cancel']).optional()
  })
  .strict()

async function installGrant(
  runtime: OrcaRuntimeService,
  grant: SkillCloudDownloadGrant,
  input: z.infer<typeof shareInstallSchema> | z.infer<typeof packageVersionInstallSchema>
) {
  const request: SkillInstallRequest = {
    operationId: randomUUID(),
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
  ipcMain.handle('skills:getPackage', (_event, packageId: unknown) =>
    runtime.getSkillPackage(z.string().min(1).max(128).parse(packageId), {})
  )
}

function registerInstallManagementHandlers(runtime: OrcaRuntimeService): void {
  ipcMain.handle('skills:listWslDistros', async (_event, environmentIdValue: unknown) => {
    const environmentId = environmentIdSchema.optional().parse(environmentIdValue)
    if (!environmentId) {
      return listWslDistrosAsync()
    }
    const response = await callRuntimeEnvironment(
      app.getPath('userData'),
      environmentId,
      'host.wsl.listDistros',
      {},
      15_000
    )
    return response.ok === true && Array.isArray(response.result)
      ? response.result.filter((distro): distro is string => typeof distro === 'string')
      : []
  })
  ipcMain.handle('skills:previewInstall', async (_event, value: unknown) => {
    const input = installPreviewSchema.parse(value)
    const request = { package: input.package, name: input.name, destination: input.destination }
    if (!input.environmentId) {
      return {
        status: 'ok' as const,
        value: await runtime.previewSharedSkillInstallRequest(request)
      }
    }
    const userDataPath = app.getPath('userData')
    if (!(await supportsSkillRuntimeManagement(userDataPath, input.environmentId))) {
      return { status: 'unsupported' as const, message: SKILL_INSTALL_UPDATE_REQUIRED_MESSAGE }
    }
    const response = await callRuntimeEnvironment(
      userDataPath,
      input.environmentId,
      'skills.previewInstall',
      request,
      30_000
    )
    if (response.ok !== true) {
      throw new Error(`skill-preview-remote-${response.error.code}`)
    }
    return { status: 'ok' as const, value: SkillInstallPreviewSchema.parse(response.result) }
  })
  ipcMain.handle('skills:removeInstall', async (_event, value: unknown) => {
    const input = removeSchema.parse(value)
    const request = {
      operationId: randomUUID(),
      name: input.name,
      destination: input.destination,
      conflictResolution: input.conflictResolution
    }
    if (!input.environmentId) {
      return {
        status: 'ok' as const,
        value: await runtime.removeSharedSkillInstallRequest(request)
      }
    }
    const userDataPath = app.getPath('userData')
    if (!(await supportsSkillRuntimeManagement(userDataPath, input.environmentId))) {
      return { status: 'unsupported' as const, message: SKILL_INSTALL_UPDATE_REQUIRED_MESSAGE }
    }
    const response = await callRuntimeEnvironment(
      userDataPath,
      input.environmentId,
      'skills.removeInstall',
      request,
      5 * 60_000
    )
    if (response.ok !== true) {
      throw new Error(`skill-remove-remote-${response.error.code}`)
    }
    return { status: 'ok' as const, value: SkillInstallResultSchema.parse(response.result) }
  })
  ipcMain.handle('skills:listManagedInstalls', async (_event, environmentIdValue: unknown) => {
    const environmentId = environmentIdSchema.optional().parse(environmentIdValue)
    if (!environmentId) {
      return { status: 'ok' as const, value: await runtime.listManagedSkillInstalls() }
    }
    if (environmentId.startsWith('ssh:')) {
      const value = await runtime.listManagedSkillInstalls(environmentId.slice('ssh:'.length))
      return { status: 'ok' as const, value }
    }
    const userDataPath = app.getPath('userData')
    if (!(await supportsSkillRuntimeManagement(userDataPath, environmentId))) {
      return { status: 'unsupported' as const, message: SKILL_INSTALL_UPDATE_REQUIRED_MESSAGE }
    }
    const response = await callRuntimeEnvironment(
      userDataPath,
      environmentId,
      'skills.listManagedInstalls',
      {},
      30_000
    )
    if (response.ok !== true) {
      throw new Error(`skill-list-managed-remote-${response.error.code}`)
    }
    return { status: 'ok' as const, value: ManagedSkillInstallListSchema.parse(response.result) }
  })
}

export function registerSkillCloudIpcHandlers(
  runtime: OrcaRuntimeService,
  discover: (target?: z.infer<typeof SkillDiscoveryTargetSchema>) => Promise<SkillDiscoveryResult>
): void {
  registerSharingHandlers(runtime, discover)
  registerCloudInstallHandlers(runtime)
  registerInstallManagementHandlers(runtime)
}
