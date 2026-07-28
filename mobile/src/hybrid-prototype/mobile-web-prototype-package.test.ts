import { Buffer } from 'buffer'
import { sha256 } from '@noble/hashes/sha256'
import { describe, expect, it } from 'vitest'
import type { RpcResponse } from '../transport/types'
import { downloadMobileWebPrototypePackage } from './mobile-web-prototype-package'

function hash(bytes: Uint8Array): string {
  return Buffer.from(sha256(bytes)).toString('hex')
}

function success(result: unknown): RpcResponse {
  return { id: 'test', ok: true, result, _meta: { runtimeId: 'test-runtime' } }
}

function createRequest(document: string, corruptChunk = false) {
  const bytes = Buffer.from(document, 'utf8')
  const buildId = hash(bytes)
  const chunkBytes = 7
  return async (method: string, params?: unknown): Promise<RpcResponse> => {
    if (method === 'mobileWeb.prototype.manifest') {
      return success({
        protocolVersion: 1,
        buildId,
        sha256: buildId,
        byteLength: bytes.byteLength,
        chunkBytes,
        contentType: 'text/html; charset=utf-8'
      })
    }
    const offset = (params as { offset: number }).offset
    const chunk = bytes.subarray(offset, Math.min(offset + chunkBytes, bytes.byteLength))
    return success({
      buildId,
      offset,
      byteLength: chunk.byteLength,
      sha256: hash(chunk),
      dataBase64: Buffer.from(
        corruptChunk && offset === 0 ? Uint8Array.from(chunk, (byte) => byte ^ 1) : chunk
      ).toString('base64')
    })
  }
}

describe('mobile web prototype package', () => {
  it('downloads and verifies a content-addressed document chunk by chunk', async () => {
    const html = '<!doctype html><title>Orca</title>'
    const prototypePackage = await downloadMobileWebPrototypePackage(createRequest(html))

    expect(prototypePackage.html).toBe(html)
    expect(prototypePackage.manifest.buildId).toMatch(/^[a-f0-9]{64}$/)
  })

  it('rejects a chunk whose bytes do not match its signed metadata', async () => {
    await expect(
      downloadMobileWebPrototypePackage(createRequest('<p>tamper test</p>', true))
    ).rejects.toThrow('chunk integrity')
  })

  it('rejects oversized and unsupported manifests before requesting chunks', async () => {
    const request = async (): Promise<RpcResponse> =>
      success({
        protocolVersion: 2,
        buildId: 'a'.repeat(64),
        sha256: 'a'.repeat(64),
        byteLength: 1024 * 1024,
        chunkBytes: 49 * 1024,
        contentType: 'text/html; charset=utf-8'
      })

    await expect(downloadMobileWebPrototypePackage(request)).rejects.toThrow(
      'manifest failed validation'
    )
  })
})
