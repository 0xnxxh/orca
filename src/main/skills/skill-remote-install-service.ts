import type { RuntimeCapability } from '../../shared/protocol-version'
import type { RuntimeRpcResponse } from '../../shared/runtime-rpc-envelope'
import {
  SkillInstallResultSchema,
  type SkillInstallRequest,
  type SkillInstallResult
} from '../../shared/skill-install-contract'
import { SKILL_UPLOAD_CAPABILITY } from '../../shared/skill-install-capability'
import { callRuntimeEnvironment } from '../ipc/runtime-environment-transport-routing'
import { transferSkillPackageToRuntime } from './skill-client-mediated-transfer'

const DIRECT_DOWNLOAD_FAILURE = 'skill-download-transport-failed'

async function install(
  userDataPath: string,
  environmentId: string,
  request: SkillInstallRequest
): Promise<RuntimeRpcResponse<unknown>> {
  return (await callRuntimeEnvironment(
    userDataPath,
    environmentId,
    'skills.install',
    request,
    5 * 60_000
  )) as RuntimeRpcResponse<unknown>
}

function isDownloadTransportFailure(response: RuntimeRpcResponse<unknown>): boolean {
  return (
    response.ok === false &&
    (response.error.code === DIRECT_DOWNLOAD_FAILURE ||
      response.error.message === DIRECT_DOWNLOAD_FAILURE)
  )
}

export async function installSkillOnRemoteRuntime(input: {
  userDataPath: string
  environmentId: string
  request: SkillInstallRequest
  capabilities: readonly RuntimeCapability[]
  requireHttps: boolean
}): Promise<SkillInstallResult> {
  if (input.request.ingress.kind !== 'download-grant') {
    throw new Error('skill-install-remote-ingress-invalid')
  }
  const direct = await install(input.userDataPath, input.environmentId, input.request)
  if (!isDownloadTransportFailure(direct)) {
    if (direct.ok !== true) {
      throw new Error(`skill-install-remote-${direct.error.code}`)
    }
    return SkillInstallResultSchema.parse(direct.result)
  }
  if (!input.capabilities.includes(SKILL_UPLOAD_CAPABILITY)) {
    throw new Error('skill-install-remote-download-unavailable')
  }

  const transfer = await transferSkillPackageToRuntime({
    userDataPath: input.userDataPath,
    environmentId: input.environmentId,
    package: input.request.package,
    grant: input.request.ingress,
    requireHttps: input.requireHttps
  })
  try {
    const staged = await install(input.userDataPath, input.environmentId, {
      ...input.request,
      ingress: { kind: 'staged-upload', uploadId: transfer.uploadId }
    })
    if (staged.ok !== true) {
      throw new Error(`skill-install-remote-${staged.error.code}`)
    }
    return SkillInstallResultSchema.parse(staged.result)
  } finally {
    await transfer.cleanup().catch(() => undefined)
  }
}
