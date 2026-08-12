import { open } from 'node:fs/promises'
import { join } from 'node:path'
import type { RuntimeRpcResponse } from '../../shared/runtime-rpc-envelope'
import type { SkillPackageIdentity } from '../../shared/skill-install-contract'
import type { SkillBundlePackageIdentity } from '../../shared/skill-bundle-install-contract'
import {
  SKILL_UPLOAD_CHUNK_MAX_BYTES,
  SkillUploadBeginResultSchema
} from '../../shared/skill-upload-session-contract'
import { callRuntimeEnvironment } from '../ipc/runtime-environment-transport-routing'
import { downloadSkillPackageGrant } from './skill-package-download'
import { retrySkillTransferRpc, throwIfSkillTransferCancelled } from './skill-transfer-rpc-retry'
function allowedOrigins(allowConfiguredOrigins: boolean): string[] {
  const origins = ['https://storage.googleapis.com']
  if (allowConfiguredOrigins && process.env.ORCA_SKILL_PACKAGE_DOWNLOAD_ORIGINS) {
    origins.push(
      ...process.env.ORCA_SKILL_PACKAGE_DOWNLOAD_ORIGINS.split(',')
        .map((origin) => origin.trim())
        .filter(Boolean)
    )
  }
  return [...new Set(origins)]
}

function retryableRemoteTransferError(error: unknown): boolean {
  return !(error instanceof Error && error.message.startsWith('skill-transfer-remote-'))
}

async function remoteCall<T>(
  userDataPath: string,
  environmentId: string,
  method: string,
  params: unknown
): Promise<T> {
  const response = (await callRuntimeEnvironment(
    userDataPath,
    environmentId,
    method,
    params,
    5 * 60_000
  )) as RuntimeRpcResponse<T>
  if (response.ok !== true) {
    throw new Error(`skill-transfer-remote-${response.error.code}`)
  }
  return response.result
}

export async function transferSkillPackageToRuntime(input: {
  userDataPath: string
  environmentId: string
  transferId: string
  package: SkillPackageIdentity | SkillBundlePackageIdentity
  grant: { url: string; expiresAt: string }
  requireHttps: boolean
  signal?: AbortSignal
}): Promise<{ uploadId: string; cleanup(): Promise<void> }> {
  const downloaded = await downloadSkillPackageGrant({
    url: input.grant.url,
    expiresAt: input.grant.expiresAt,
    expectedArchiveSha256: input.package.archiveSha256,
    expectedCompressedBytes: input.package.compressedBytes,
    temporaryRoot: join(input.userDataPath, 'skill-installs', 'client-transfers'),
    allowedOrigins: allowedOrigins(!input.requireHttps),
    requireHttps: input.requireHttps,
    signal: input.signal
  })
  let uploadId: string | null = null
  try {
    const begun = SkillUploadBeginResultSchema.parse(
      await retrySkillTransferRpc({
        signal: input.signal,
        retryable: retryableRemoteTransferError,
        checkCancellationAfterSuccess: false,
        call: () =>
          remoteCall(input.userDataPath, input.environmentId, 'skills.beginUpload', {
            package: input.package,
            transferId: input.transferId
          })
      })
    )
    uploadId = begun.uploadId
    throwIfSkillTransferCancelled(input.signal)
    const chunkBytes = Math.min(begun.chunkBytes, SKILL_UPLOAD_CHUNK_MAX_BYTES)
    if (begun.acknowledgedOffset > input.package.compressedBytes) {
      throw new Error('skill-transfer-offset-invalid')
    }
    if (!Number.isInteger(chunkBytes) || chunkBytes < 1) {
      throw new Error('skill-transfer-chunk-size-invalid')
    }
    const handle = await open(downloaded.archivePath, 'r')
    try {
      let offset = begun.acknowledgedOffset
      while (offset < input.package.compressedBytes) {
        const bytes = Buffer.alloc(Math.min(chunkBytes, input.package.compressedBytes - offset))
        const read = await handle.read(bytes, 0, bytes.length, offset)
        if (read.bytesRead !== bytes.length) {
          throw new Error('skill-transfer-source-changed')
        }
        const acknowledged = await retrySkillTransferRpc({
          signal: input.signal,
          retryable: retryableRemoteTransferError,
          call: () =>
            remoteCall<{ acknowledgedOffset: number }>(
              input.userDataPath,
              input.environmentId,
              'skills.uploadChunk',
              { uploadId, offset, bytesBase64: bytes.toString('base64') }
            )
        })
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
      retryable: retryableRemoteTransferError,
      call: () =>
        remoteCall(input.userDataPath, input.environmentId, 'skills.commitUpload', { uploadId })
    })
    const committedId = uploadId
    uploadId = null
    return {
      uploadId: committedId,
      cleanup: () =>
        remoteCall(input.userDataPath, input.environmentId, 'skills.cancelUpload', {
          uploadId: committedId
        })
    }
  } finally {
    await downloaded.cleanup()
    if (uploadId) {
      await remoteCall(input.userDataPath, input.environmentId, 'skills.cancelUpload', {
        uploadId
      }).catch(() => undefined)
    }
  }
}
