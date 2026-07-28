import { Buffer } from 'buffer'
import { sha256 } from '@noble/hashes/sha256'
import {
  MOBILE_WEB_PROTOTYPE_CHUNK_BYTES,
  MOBILE_WEB_PROTOTYPE_MAX_BYTES,
  MOBILE_WEB_PROTOTYPE_PROTOCOL_VERSION,
  type MobileWebPrototypeChunk,
  type MobileWebPrototypeManifest
} from '../../../src/shared/mobile-web-prototype-contract'
import type { RpcResponse } from '../transport/types'

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

export type VerifiedMobileWebPrototypePackage = {
  manifest: MobileWebPrototypeManifest
  html: string
}

export type MobileWebPrototypeRequest = (method: string, params?: unknown) => Promise<RpcResponse>

function sha256Hex(bytes: Uint8Array): string {
  return Buffer.from(sha256(bytes)).toString('hex')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && SHA256_HEX_PATTERN.test(value)
}

function parseManifest(value: unknown): MobileWebPrototypeManifest {
  if (!isRecord(value)) {
    throw new Error('Prototype manifest is not an object.')
  }
  const manifest = value as Partial<MobileWebPrototypeManifest>
  if (
    manifest.protocolVersion !== MOBILE_WEB_PROTOTYPE_PROTOCOL_VERSION ||
    !isSha256(manifest.buildId) ||
    !isSha256(manifest.sha256) ||
    manifest.buildId !== manifest.sha256 ||
    !Number.isInteger(manifest.byteLength) ||
    typeof manifest.byteLength !== 'number' ||
    manifest.byteLength <= 0 ||
    manifest.byteLength > MOBILE_WEB_PROTOTYPE_MAX_BYTES ||
    !Number.isInteger(manifest.chunkBytes) ||
    typeof manifest.chunkBytes !== 'number' ||
    manifest.chunkBytes <= 0 ||
    manifest.chunkBytes > MOBILE_WEB_PROTOTYPE_CHUNK_BYTES ||
    manifest.contentType !== 'text/html; charset=utf-8'
  ) {
    throw new Error('Prototype manifest failed validation.')
  }
  return manifest as MobileWebPrototypeManifest
}

function decodeCanonicalBase64(value: unknown): Uint8Array {
  if (typeof value !== 'string' || !BASE64_PATTERN.test(value)) {
    throw new Error('Prototype chunk is not valid base64.')
  }
  const bytes = Buffer.from(value, 'base64')
  if (bytes.toString('base64') !== value) {
    throw new Error('Prototype chunk is not canonical base64.')
  }
  return bytes
}

function parseChunk(
  value: unknown,
  manifest: MobileWebPrototypeManifest,
  expectedOffset: number
): Uint8Array {
  if (!isRecord(value)) {
    throw new Error('Prototype chunk is not an object.')
  }
  const chunk = value as Partial<MobileWebPrototypeChunk>
  const expectedLength = Math.min(manifest.chunkBytes, manifest.byteLength - expectedOffset)
  if (
    chunk.buildId !== manifest.buildId ||
    chunk.offset !== expectedOffset ||
    chunk.byteLength !== expectedLength ||
    !isSha256(chunk.sha256)
  ) {
    throw new Error('Prototype chunk metadata failed validation.')
  }
  const bytes = decodeCanonicalBase64(chunk.dataBase64)
  if (bytes.byteLength !== expectedLength || sha256Hex(bytes) !== chunk.sha256) {
    throw new Error('Prototype chunk integrity check failed.')
  }
  return bytes
}

async function requestResult(
  request: MobileWebPrototypeRequest,
  method: string,
  params?: unknown
): Promise<unknown> {
  const response = await request(method, params)
  if (!response.ok) {
    throw new Error(response.error.message || `Request failed: ${method}`)
  }
  return response.result
}

export async function downloadMobileWebPrototypePackage(
  request: MobileWebPrototypeRequest
): Promise<VerifiedMobileWebPrototypePackage> {
  const manifest = parseManifest(await requestResult(request, 'mobileWeb.prototype.manifest'))
  const chunks: Uint8Array[] = []

  for (let offset = 0; offset < manifest.byteLength; offset += manifest.chunkBytes) {
    const result = await requestResult(request, 'mobileWeb.prototype.chunk', {
      buildId: manifest.buildId,
      offset
    })
    chunks.push(parseChunk(result, manifest, offset))
  }

  const documentBytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))
  if (
    documentBytes.byteLength !== manifest.byteLength ||
    sha256Hex(documentBytes) !== manifest.sha256
  ) {
    throw new Error('Prototype document integrity check failed.')
  }

  return { manifest, html: documentBytes.toString('utf8') }
}

export function verifyMobileWebPrototypePackage(
  value: unknown
): VerifiedMobileWebPrototypePackage | null {
  if (!isRecord(value) || typeof value.html !== 'string') {
    return null
  }
  try {
    const manifest = parseManifest(value.manifest)
    const bytes = Buffer.from(value.html, 'utf8')
    if (bytes.byteLength !== manifest.byteLength || sha256Hex(bytes) !== manifest.sha256) {
      return null
    }
    return { manifest, html: value.html }
  } catch {
    return null
  }
}
