import { randomUUID } from 'node:crypto'
import { app, ipcMain } from 'electron'
import { z } from 'zod'
import { SKILL_INSTALL_UPDATE_REQUIRED_MESSAGE } from '../../shared/skill-install-capability'
import {
  ManagedSkillInstallListSchema,
  SkillInstallDestinationSchema,
  SkillInstallPreviewSchema,
  SkillInstallResultSchema,
  SkillPackageIdentitySchema
} from '../../shared/skill-install-contract'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { supportsSkillRuntimeManagement } from '../skills/skill-runtime-capability'
import { listWslDistrosAsync } from '../wsl'
import { callRuntimeEnvironment } from './runtime-environment-transport-routing'

const environmentIdSchema = z.string().min(1).max(128)
const skillNameSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
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

export function registerSkillInstallManagementIpcHandlers(runtime: OrcaRuntimeService): void {
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
