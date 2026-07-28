import { createHash } from 'node:crypto'
import {
  MOBILE_WEB_PROTOTYPE_CHUNK_BYTES,
  MOBILE_WEB_PROTOTYPE_PROTOCOL_VERSION,
  type MobileWebPrototypeChunk,
  type MobileWebPrototypeManifest
} from '../../../shared/mobile-web-prototype-contract'
import { buildMobileWebPrototypeDocument } from './mobile-web-prototype-document'

type MobileWebPrototypePackage = {
  bytes: Buffer
  manifest: MobileWebPrototypeManifest
}

let cachedPackage: MobileWebPrototypePackage | null = null

function sha256Hex(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function getPackage(): MobileWebPrototypePackage {
  if (cachedPackage) {
    return cachedPackage
  }
  const bytes = Buffer.from(buildMobileWebPrototypeDocument(), 'utf8')
  const sha256 = sha256Hex(bytes)
  cachedPackage = {
    bytes,
    manifest: {
      protocolVersion: MOBILE_WEB_PROTOTYPE_PROTOCOL_VERSION,
      buildId: sha256,
      sha256,
      byteLength: bytes.byteLength,
      chunkBytes: MOBILE_WEB_PROTOTYPE_CHUNK_BYTES,
      contentType: 'text/html; charset=utf-8'
    }
  }
  return cachedPackage
}

export function getMobileWebPrototypeManifest(): MobileWebPrototypeManifest {
  return getPackage().manifest
}

export function getMobileWebPrototypeChunk(
  buildId: string,
  offset: number
): MobileWebPrototypeChunk {
  const prototypePackage = getPackage()
  if (buildId !== prototypePackage.manifest.buildId) {
    throw new Error('mobile_web_prototype_build_changed')
  }
  if (offset < 0 || offset >= prototypePackage.bytes.byteLength) {
    throw new Error('mobile_web_prototype_offset_invalid')
  }
  const bytes = prototypePackage.bytes.subarray(
    offset,
    Math.min(offset + MOBILE_WEB_PROTOTYPE_CHUNK_BYTES, prototypePackage.bytes.byteLength)
  )
  return {
    buildId,
    offset,
    byteLength: bytes.byteLength,
    sha256: sha256Hex(bytes),
    dataBase64: bytes.toString('base64')
  }
}
