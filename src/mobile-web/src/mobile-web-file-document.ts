import {
  MOBILE_WEB_FILE_CHUNK_MAX_BYTES,
  type MobileWebFileChunkResult
} from '../../shared/mobile-web/bridge-operation-contract'
import { MobileWebBridgeClientError } from './mobile-web-bridge-client-error'
import { mobileWebFileRevision } from './mobile-web-file-edit-content'

export const MOBILE_WEB_FILE_DOCUMENT_MAX_BYTES = 1024 * 1024

export type MobileWebFileDocument = {
  workspaceId: string
  relativePath: string
  bytes: Uint8Array
  content: string
  kind: 'text' | 'binary'
  eof: boolean
  limitReached: boolean
  revision: string | null
}

export function mobileWebFileNextChunkLength(
  document: MobileWebFileDocument | null,
  maximumBytes = MOBILE_WEB_FILE_DOCUMENT_MAX_BYTES
): number {
  const remaining = maximumBytes - (document?.bytes.byteLength ?? 0)
  return Math.min(MOBILE_WEB_FILE_CHUNK_MAX_BYTES, remaining)
}

export function appendMobileWebFileChunk(
  document: MobileWebFileDocument | null,
  chunk: MobileWebFileChunkResult,
  maximumBytes = MOBILE_WEB_FILE_DOCUMENT_MAX_BYTES
): MobileWebFileDocument {
  const expectedOffset = document?.bytes.byteLength ?? 0
  if (
    chunk.offset !== expectedOffset ||
    (document &&
      (document.workspaceId !== chunk.workspaceId ||
        document.relativePath !== chunk.relativePath)) ||
    (chunk.bytesRead === 0 && !chunk.eof) ||
    chunk.bytesRead > maximumBytes - expectedOffset
  ) {
    throw new MobileWebBridgeClientError('invalid_message', false)
  }

  const bytes = new Uint8Array(expectedOffset + chunk.bytesRead)
  if (document) {
    bytes.set(document.bytes)
  }
  bytes.set(chunk.bytes, expectedOffset)
  const limitReached = bytes.byteLength >= maximumBytes && !chunk.eof
  const decoded = decodeMobileWebText(bytes, chunk.eof)
  return {
    workspaceId: chunk.workspaceId,
    relativePath: chunk.relativePath,
    bytes,
    content: decoded ?? '',
    kind: document?.kind === 'binary' || decoded === null ? 'binary' : 'text',
    eof: chunk.eof,
    limitReached,
    revision: chunk.eof && decoded !== null ? mobileWebFileRevision(bytes) : null
  }
}

function decodeMobileWebText(bytes: Uint8Array, eof: boolean): string | null {
  if (bytes.includes(0)) {
    return null
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: !eof })
  } catch {
    return null
  }
}
