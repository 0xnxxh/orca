import { MOBILE_WEB_NATIVE_CHAT_EVENT_MAX_BYTES } from '../../../src/shared/mobile-web/native-chat-operation-contract'
import type { MobileWebOperationGrant } from './mobile-web-production-grants'

export const MOBILE_WEB_PRODUCTION_NATIVE_CHAT_GRANTS = [
  grant('read', 2048, MOBILE_WEB_NATIVE_CHAT_EVENT_MAX_BYTES, 2, 8, 2),
  grant('subscribe', 2048, MOBILE_WEB_NATIVE_CHAT_EVENT_MAX_BYTES, 2, 4, 1),
  grant('sendMessage', 72 * 1024, 256, 1, 12, 4),
  grant('prepareCommit', 2048, 256, 1, 12, 4),
  grant('respond', 8 * 1024, 256, 1, 20, 8),
  grant('stop', 2048, 256, 1, 8, 2),
  grant('attachImage', 2048, 272 * 1024, 1, 8, 2),
  grant('pasteImages', 8 * 1024, 256, 1, 12, 4),
  grant('releaseImages', 8 * 1024, 256, 2, 20, 8),
  grant('pendingRead', 2048, 72 * 1024, 2, 12, 4),
  grant('pendingWrite', 72 * 1024, 256, 2, 16, 8),
  grant('fileSearch', 4096, 32 * 1024, 2, 12, 4),
  grant('openFile', 8192, 256, 1, 12, 4),
  grant('readability', 1024, 256, 2, 4, 1)
] as const satisfies readonly MobileWebOperationGrant[]

function grant(
  operation:
    | 'read'
    | 'subscribe'
    | 'sendMessage'
    | 'prepareCommit'
    | 'respond'
    | 'stop'
    | 'attachImage'
    | 'pasteImages'
    | 'releaseImages'
    | 'pendingRead'
    | 'pendingWrite'
    | 'fileSearch'
    | 'openFile'
    | 'readability',
  maxRequestBytes: number,
  maxResponseBytes: number,
  maxConcurrent: number,
  rateCapacity: number,
  rateRefillPerSecond: number
) {
  return {
    capability: 'nativeChat',
    operation,
    limits: {
      maxRequestBytes,
      maxResponseBytes,
      maxConcurrent,
      rateCapacity,
      rateRefillPerSecond
    }
  } as const
}
