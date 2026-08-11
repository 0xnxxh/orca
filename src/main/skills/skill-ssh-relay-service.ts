import { open } from 'node:fs/promises'
import { join } from 'node:path'
import {
  SKILL_INSTALL_CAPABILITY,
  SKILL_MANAGEMENT_CAPABILITY,
  SKILL_UPLOAD_CAPABILITY
} from '../../shared/skill-install-capability'
import {
  ManagedSkillInstallListSchema,
  SkillInstallPreviewSchema,
  SkillInstallResultSchema,
  type ManagedSkillInstall,
  type SkillInstallPreview,
  type SkillInstallPreviewRequest,
  type SkillInstallRequest,
  type SkillInstallResult,
  type SkillRemoveRequest
} from '../../shared/skill-install-contract'
import {
  SKILL_SSH_RELAY_BEGIN_UPLOAD_METHOD,
  SKILL_SSH_RELAY_CANCEL_UPLOAD_METHOD,
  SKILL_SSH_RELAY_COMMIT_UPLOAD_METHOD,
  SKILL_SSH_RELAY_INSTALL_METHOD,
  SKILL_SSH_RELAY_LIST_METHOD,
  SKILL_SSH_RELAY_PREVIEW_METHOD,
  SKILL_SSH_RELAY_REMOVE_METHOD,
  SKILL_SSH_RELAY_UPLOAD_CHUNK_METHOD,
  type SkillSshWorkspaceAuthority
} from '../../shared/skill-ssh-relay-contract'
import { SKILL_UPLOAD_CHUNK_MAX_BYTES } from '../../shared/skill-upload-session-contract'
import type { IPtyProvider } from '../providers/pty-provider-contract'
import { downloadSkillPackageGrant } from './skill-package-download'
import { retrySkillTransferRpc } from './skill-transfer-rpc-retry'

const REQUEST_TIMEOUT_MS = 5 * 60_000
const DIRECT_DOWNLOAD_FAILURE = 'skill-download-transport-failed'

type SkillSshRelayClient = NonNullable<IPtyProvider['requestHostRpc']>

function requireClient(provider: IPtyProvider): SkillSshRelayClient {
  if (!provider.requestHostRpc) {
    throw new Error('skill-install-ssh-relay-unavailable')
  }
  return provider.requestHostRpc
}

function allowedOrigins(requireHttps: boolean): string[] {
  const origins = ['https://storage.googleapis.com']
  if (!requireHttps && process.env.ORCA_SKILL_PACKAGE_DOWNLOAD_ORIGINS) {
    origins.push(
      ...process.env.ORCA_SKILL_PACKAGE_DOWNLOAD_ORIGINS.split(',')
        .map((origin) => origin.trim())
        .filter(Boolean)
    )
  }
  return [...new Set(origins)]
}

async function capabilities(client: SkillSshRelayClient): Promise<string[]> {
  const status = (await client('relay.status', {}, { timeoutMs: 15_000 })) as {
    capabilities?: unknown
  }
  return Array.isArray(status.capabilities)
    ? status.capabilities.filter((value): value is string => typeof value === 'string')
    : []
}

export async function supportsSkillManagementOnSsh(provider: IPtyProvider): Promise<boolean> {
  return (await capabilities(requireClient(provider))).includes(SKILL_MANAGEMENT_CAPABILITY)
}

export async function installSkillOnSshHost(input: {
  provider: IPtyProvider
  userDataPath: string
  request: SkillInstallRequest
  workspace?: SkillSshWorkspaceAuthority
  requireHttps: boolean
  signal?: AbortSignal
  fetcher?: typeof fetch
}): Promise<SkillInstallResult> {
  const client = requireClient(input.provider)
  const supported = await capabilities(client)
  if (!supported.includes(SKILL_INSTALL_CAPABILITY)) {
    throw new Error('skill-install-ssh-update-required')
  }
  try {
    return SkillInstallResultSchema.parse(
      await client(
        SKILL_SSH_RELAY_INSTALL_METHOD,
        { request: input.request, workspace: input.workspace },
        { timeoutMs: REQUEST_TIMEOUT_MS, signal: input.signal }
      )
    )
  } catch (error) {
    if (
      input.request.ingress.kind !== 'download-grant' ||
      (error as Error).message !== DIRECT_DOWNLOAD_FAILURE
    ) {
      throw error
    }
  }
  if (!supported.includes(SKILL_UPLOAD_CAPABILITY)) {
    throw new Error('skill-install-ssh-download-unavailable')
  }
  const uploadId = await transferSkillPackageToSshHost(client, input)
  try {
    return SkillInstallResultSchema.parse(
      await client(
        SKILL_SSH_RELAY_INSTALL_METHOD,
        {
          request: {
            ...input.request,
            ingress: { kind: 'staged-upload', uploadId }
          },
          workspace: input.workspace
        },
        { timeoutMs: REQUEST_TIMEOUT_MS, signal: input.signal }
      )
    )
  } finally {
    await client(SKILL_SSH_RELAY_CANCEL_UPLOAD_METHOD, { uploadId }).catch(() => undefined)
  }
}

export async function previewSkillInstallOnSshHost(input: {
  provider: IPtyProvider
  request: SkillInstallPreviewRequest
  workspace?: SkillSshWorkspaceAuthority
}): Promise<SkillInstallPreview> {
  const client = requireClient(input.provider)
  if (!(await capabilities(client)).includes(SKILL_MANAGEMENT_CAPABILITY)) {
    throw new Error('skill-install-ssh-update-required')
  }
  return SkillInstallPreviewSchema.parse(
    await client(
      SKILL_SSH_RELAY_PREVIEW_METHOD,
      { request: input.request, workspace: input.workspace },
      { timeoutMs: 30_000 }
    )
  )
}

export async function removeSkillInstallOnSshHost(input: {
  provider: IPtyProvider
  request: SkillRemoveRequest
  workspace?: SkillSshWorkspaceAuthority
}): Promise<SkillInstallResult> {
  const client = requireClient(input.provider)
  if (!(await capabilities(client)).includes(SKILL_MANAGEMENT_CAPABILITY)) {
    throw new Error('skill-install-ssh-update-required')
  }
  return SkillInstallResultSchema.parse(
    await client(
      SKILL_SSH_RELAY_REMOVE_METHOD,
      { request: input.request, workspace: input.workspace },
      { timeoutMs: REQUEST_TIMEOUT_MS }
    )
  )
}

export async function listSkillInstallsOnSshHost(input: {
  provider: IPtyProvider
  connectionId: string
  workspaces: SkillSshWorkspaceAuthority[]
}): Promise<ManagedSkillInstall[]> {
  const client = requireClient(input.provider)
  if (!(await capabilities(client)).includes(SKILL_MANAGEMENT_CAPABILITY)) {
    throw new Error('skill-install-ssh-update-required')
  }
  return ManagedSkillInstallListSchema.parse(
    await client(
      SKILL_SSH_RELAY_LIST_METHOD,
      { workspaces: input.workspaces },
      { timeoutMs: 30_000 }
    )
  ).map((install) => ({
    ...install,
    destination:
      install.destination.scope === 'global'
        ? {
            scope: 'global' as const,
            executionTarget: { kind: 'ssh' as const, connectionId: input.connectionId }
          }
        : install.destination
  }))
}

async function transferSkillPackageToSshHost(
  client: SkillSshRelayClient,
  input: Parameters<typeof installSkillOnSshHost>[0]
): Promise<string> {
  if (input.request.ingress.kind !== 'download-grant') {
    throw new Error('skill-install-ssh-ingress-invalid')
  }
  const downloaded = await downloadSkillPackageGrant({
    url: input.request.ingress.url,
    expiresAt: input.request.ingress.expiresAt,
    expectedArchiveSha256: input.request.package.archiveSha256,
    expectedCompressedBytes: input.request.package.compressedBytes,
    temporaryRoot: join(input.userDataPath, 'skill-installs', 'ssh-transfers'),
    allowedOrigins: allowedOrigins(input.requireHttps),
    requireHttps: input.requireHttps,
    signal: input.signal,
    fetcher: input.fetcher
  })
  let uploadId: string | null = null
  try {
    const begun = (await client(
      SKILL_SSH_RELAY_BEGIN_UPLOAD_METHOD,
      { package: input.request.package },
      { timeoutMs: REQUEST_TIMEOUT_MS, signal: input.signal }
    )) as { uploadId: string; chunkBytes: number }
    uploadId = begun.uploadId
    const chunkBytes = Math.min(begun.chunkBytes, SKILL_UPLOAD_CHUNK_MAX_BYTES)
    if (!uploadId || !Number.isInteger(chunkBytes) || chunkBytes < 1) {
      throw new Error('skill-transfer-ssh-begin-invalid')
    }
    const handle = await open(downloaded.archivePath, 'r')
    try {
      let offset = 0
      while (offset < input.request.package.compressedBytes) {
        const bytes = Buffer.alloc(
          Math.min(chunkBytes, input.request.package.compressedBytes - offset)
        )
        const read = await handle.read(bytes, 0, bytes.length, offset)
        if (read.bytesRead !== bytes.length) {
          throw new Error('skill-transfer-source-changed')
        }
        const acknowledged = (await retrySkillTransferRpc({
          signal: input.signal,
          retryable: (error) =>
            typeof (error as { code?: unknown })?.code !== 'number' &&
            (error as Error)?.name !== 'AbortError',
          call: () =>
            client(
              SKILL_SSH_RELAY_UPLOAD_CHUNK_METHOD,
              { uploadId, offset, bytesBase64: bytes.toString('base64') },
              { timeoutMs: REQUEST_TIMEOUT_MS, signal: input.signal }
            )
        })) as { acknowledgedOffset: number }
        if (acknowledged.acknowledgedOffset !== offset + bytes.length) {
          throw new Error('skill-transfer-ack-invalid')
        }
        offset = acknowledged.acknowledgedOffset
      }
    } finally {
      await handle.close()
    }
    await retrySkillTransferRpc({
      signal: input.signal,
      retryable: (error) =>
        typeof (error as { code?: unknown })?.code !== 'number' &&
        (error as Error)?.name !== 'AbortError',
      call: () =>
        client(
          SKILL_SSH_RELAY_COMMIT_UPLOAD_METHOD,
          { uploadId },
          { timeoutMs: REQUEST_TIMEOUT_MS, signal: input.signal }
        )
    })
    const committedId = uploadId
    uploadId = null
    return committedId
  } finally {
    await downloaded.cleanup()
    if (uploadId) {
      await client(SKILL_SSH_RELAY_CANCEL_UPLOAD_METHOD, { uploadId }).catch(() => undefined)
    }
  }
}
