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
import { SkillInstallFailureSchema } from '../../shared/skill-install-failure'
import { SkillInstallOperationError } from './skill-install-operation-error'
import { retrySkillTransferRpc } from './skill-transfer-rpc-retry'
import {
  isRecoverableRemoteRuntimeConnectionError,
  toRemoteRuntimeClientErrorLike
} from '../../shared/remote-runtime-client-error-classification'

const DIRECT_DOWNLOAD_FAILURE = 'skill-download-transport-failed'
const DEVELOPMENT_DOWNLOAD_POLICY_FAILURES = new Set([
  'skill-download-url-rejected',
  'skill-download-origin-rejected'
])

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

function isDirectDownloadUnavailable(
  response: RuntimeRpcResponse<unknown>,
  requireHttps: boolean
): boolean {
  const structured =
    response.ok === false ? SkillInstallFailureSchema.safeParse(response.error.data) : null
  if (response.ok === true) {
    return false
  }
  const codes = [
    response.error.code,
    response.error.message,
    ...(structured?.success === true ? [structured.data.code] : [])
  ]
  return (
    codes.includes(DIRECT_DOWNLOAD_FAILURE) ||
    (!requireHttps && codes.some((code) => DEVELOPMENT_DOWNLOAD_POLICY_FAILURES.has(code)))
  )
}

function remoteFailure(response: RuntimeRpcResponse<unknown>): Error {
  if (response.ok === true) {
    return new Error('skill-install-remote-response-invalid')
  }
  const failure = SkillInstallFailureSchema.safeParse(response.error.data)
  return failure.success
    ? new SkillInstallOperationError(failure.data)
    : new Error('skill-install-remote-failed')
}

function retryableRemoteInstallTransportError(error: unknown): boolean {
  return isRecoverableRemoteRuntimeConnectionError(toRemoteRuntimeClientErrorLike(error))
}

export async function installSkillOnRemoteRuntime(input: {
  userDataPath: string
  environmentId: string
  request: SkillInstallRequest
  capabilities: readonly RuntimeCapability[]
  requireHttps: boolean
  signal?: AbortSignal
}): Promise<SkillInstallResult> {
  if (input.request.ingress.kind !== 'download-grant') {
    throw new Error('skill-install-remote-ingress-invalid')
  }
  const grant = input.request.ingress
  const direct = await retrySkillTransferRpc({
    signal: input.signal,
    retryable: retryableRemoteInstallTransportError,
    call: () => install(input.userDataPath, input.environmentId, input.request)
  })
  if (!isDirectDownloadUnavailable(direct, input.requireHttps)) {
    if (direct.ok !== true) {
      throw remoteFailure(direct)
    }
    return SkillInstallResultSchema.parse(direct.result)
  }
  if (!input.capabilities.includes(SKILL_UPLOAD_CAPABILITY)) {
    throw new Error('skill-install-remote-download-unavailable')
  }

  return retrySkillTransferRpc({
    signal: input.signal,
    retryable: retryableRemoteInstallTransportError,
    call: async () => {
      const transfer = await transferSkillPackageToRuntime({
        userDataPath: input.userDataPath,
        environmentId: input.environmentId,
        transferId: input.request.operationId,
        package: input.request.package,
        grant,
        requireHttps: input.requireHttps,
        signal: input.signal
      })
      try {
        const staged = await install(input.userDataPath, input.environmentId, {
          ...input.request,
          ingress: { kind: 'staged-upload', uploadId: transfer.uploadId }
        })
        if (staged.ok !== true) {
          throw remoteFailure(staged)
        }
        return SkillInstallResultSchema.parse(staged.result)
      } finally {
        await transfer.cleanup().catch(() => undefined)
      }
    }
  })
}
