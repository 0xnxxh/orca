import {
  SkillBundleInstallResultSchema,
  type SkillBundleInstallRequest,
  type SkillBundleInstallResult
} from '../../shared/skill-bundle-install-contract'
import {
  SKILL_BUNDLE_INSTALL_CAPABILITY,
  SKILL_UPLOAD_CAPABILITY
} from '../../shared/skill-install-capability'
import {
  SKILL_SSH_RELAY_CANCEL_UPLOAD_METHOD,
  SKILL_SSH_RELAY_INSTALL_BUNDLE_METHOD,
  type SkillSshWorkspaceAuthority
} from '../../shared/skill-ssh-relay-contract'
import type { IPtyProvider } from '../providers/pty-provider-contract'
import {
  SKILL_SSH_REQUEST_TIMEOUT_MS,
  requireSkillSshRelayClient,
  retryableSkillSshTransportError,
  shouldUseSkillSshClientTransfer,
  skillSshRelayCapabilities
} from './skill-ssh-relay-client'
import { transferSkillPackageToSshHost } from './skill-ssh-package-transfer'
import { retrySkillTransferRpc } from './skill-transfer-rpc-retry'

export async function installSkillBundleOnSshHost(input: {
  provider: IPtyProvider
  userDataPath: string
  request: SkillBundleInstallRequest
  workspace?: SkillSshWorkspaceAuthority
  requireHttps: boolean
  signal?: AbortSignal
  fetcher?: typeof fetch
}): Promise<SkillBundleInstallResult> {
  const client = requireSkillSshRelayClient(input.provider)
  const supported = await skillSshRelayCapabilities(client)
  if (!supported.includes(SKILL_BUNDLE_INSTALL_CAPABILITY)) {
    throw new Error('skill-bundle-ssh-update-required')
  }
  try {
    return SkillBundleInstallResultSchema.parse(
      await retrySkillTransferRpc({
        signal: input.signal,
        retryable: retryableSkillSshTransportError,
        call: () =>
          client(
            SKILL_SSH_RELAY_INSTALL_BUNDLE_METHOD,
            { request: input.request, workspace: input.workspace },
            { timeoutMs: SKILL_SSH_REQUEST_TIMEOUT_MS, signal: input.signal }
          )
      })
    )
  } catch (error) {
    if (
      input.request.ingress.kind !== 'download-grant' ||
      !shouldUseSkillSshClientTransfer(error, input.requireHttps)
    ) {
      throw error
    }
  }
  if (!supported.includes(SKILL_UPLOAD_CAPABILITY)) {
    throw new Error('skill-bundle-ssh-download-unavailable')
  }
  return retrySkillTransferRpc({
    signal: input.signal,
    retryable: retryableSkillSshTransportError,
    call: async () => {
      const uploadId = await transferSkillPackageToSshHost(client, input)
      try {
        return SkillBundleInstallResultSchema.parse(
          await client(
            SKILL_SSH_RELAY_INSTALL_BUNDLE_METHOD,
            {
              request: {
                ...input.request,
                ingress: { kind: 'staged-upload', uploadId }
              },
              workspace: input.workspace
            },
            { timeoutMs: SKILL_SSH_REQUEST_TIMEOUT_MS, signal: input.signal }
          )
        )
      } finally {
        await client(SKILL_SSH_RELAY_CANCEL_UPLOAD_METHOD, { uploadId }).catch(() => undefined)
      }
    }
  })
}
