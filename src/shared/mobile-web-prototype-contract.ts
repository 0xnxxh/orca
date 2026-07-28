export const MOBILE_WEB_PROTOTYPE_PROTOCOL_VERSION = 1
export const MOBILE_WEB_PROTOTYPE_CHUNK_BYTES = 48 * 1024
export const MOBILE_WEB_PROTOTYPE_MAX_BYTES = 512 * 1024

export type MobileWebPrototypeManifest = {
  protocolVersion: typeof MOBILE_WEB_PROTOTYPE_PROTOCOL_VERSION
  buildId: string
  sha256: string
  byteLength: number
  chunkBytes: number
  contentType: 'text/html; charset=utf-8'
}

export type MobileWebPrototypeChunk = {
  buildId: string
  offset: number
  byteLength: number
  sha256: string
  dataBase64: string
}

export type MobileWebPrototypeWorkspace = {
  id: string
  name: string
  repo: string
  branch: string
  isActive: boolean
  liveTerminalCount: number
}

export type MobileWebPrototypeRequest =
  | { v: 1; type: 'ready' }
  | { v: 1; type: 'workspace.list'; id: string }
  | { v: 1; type: 'haptic.selection'; id: string }

export type MobileWebPrototypeResponse =
  | {
      v: 1
      type: 'init'
      buildId: string
      host: { id: string; name: string }
      connection: string
      capabilities: readonly ['workspace.list', 'haptic.selection']
    }
  | { v: 1; type: 'connection'; state: string }
  | {
      v: 1
      type: 'response'
      id: string
      ok: true
      result: { workspaces: MobileWebPrototypeWorkspace[] } | null
    }
  | { v: 1; type: 'response'; id: string; ok: false; error: string }
