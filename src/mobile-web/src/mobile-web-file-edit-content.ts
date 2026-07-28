import { sha256 } from '@noble/hashes/sha256'
import { MOBILE_WEB_FILE_EDIT_MAX_BYTES } from '../../shared/mobile-web/file-edit-contract'
import { MobileWebBridgeClientError } from './mobile-web-bridge-client-error'

export function encodeMobileWebFileEdit(content: string): {
  contentBase64: string
  revision: string
  byteLength: number
} {
  const bytes = new TextEncoder().encode(content)
  if (bytes.byteLength > MOBILE_WEB_FILE_EDIT_MAX_BYTES) {
    throw new MobileWebBridgeClientError('too_large', false)
  }
  let binary = ''
  for (let offset = 0; offset < bytes.byteLength; offset += 32 * 1024) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32 * 1024))
  }
  return {
    contentBase64: btoa(binary),
    revision: mobileWebFileRevision(bytes),
    byteLength: bytes.byteLength
  }
}

export function mobileWebFileRevision(bytes: Uint8Array): string {
  return Array.from(sha256(bytes), (value) => value.toString(16).padStart(2, '0')).join('')
}
