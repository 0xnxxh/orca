import type { MobileWebBridgeShellMessage } from '../../../src/shared/mobile-web/bridge-contract'
import {
  MOBILE_WEB_FILE_CHUNK_MAX_BASE64_CHARS,
  MOBILE_WEB_FILE_CONTENT_MAX_BASE64_CHARS
} from '../../../src/shared/mobile-web/bridge-operation-contract'
import { MOBILE_WEB_FILE_EDIT_MAX_BASE64_CHARACTERS } from '../../../src/shared/mobile-web/file-edit-contract'
import { MOBILE_WEB_MARKDOWN_CONTENT_MAX_BASE64_CHARACTERS } from '../../../src/shared/mobile-web/markdown-operation-contract'

type MobileWebFileOperationGrant = Extract<
  MobileWebBridgeShellMessage,
  { type: 'init' }
>['grants'][number]

export const MOBILE_WEB_PRODUCTION_FILE_GRANTS = [
  {
    capability: 'file',
    operation: 'list',
    limits: {
      maxRequestBytes: 2048,
      maxResponseBytes: 64 * 1024,
      maxConcurrent: 2,
      rateCapacity: 8,
      rateRefillPerSecond: 2
    }
  },
  {
    capability: 'file',
    operation: 'search',
    limits: {
      maxRequestBytes: 4096,
      maxResponseBytes: 64 * 1024,
      maxConcurrent: 2,
      rateCapacity: 12,
      rateRefillPerSecond: 4
    }
  },
  {
    capability: 'file',
    operation: 'directory',
    limits: {
      maxRequestBytes: 4096,
      maxResponseBytes: 64 * 1024,
      maxConcurrent: 2,
      rateCapacity: 12,
      rateRefillPerSecond: 4
    }
  },
  {
    capability: 'file',
    operation: 'read',
    limits: {
      maxRequestBytes: 4096,
      maxResponseBytes: MOBILE_WEB_FILE_CONTENT_MAX_BASE64_CHARS + 4096,
      maxConcurrent: 2,
      rateCapacity: 8,
      rateRefillPerSecond: 2
    }
  },
  {
    capability: 'file',
    operation: 'readChunk',
    limits: {
      maxRequestBytes: 4096,
      maxResponseBytes: MOBILE_WEB_FILE_CHUNK_MAX_BASE64_CHARS + 4096,
      maxConcurrent: 2,
      rateCapacity: 16,
      rateRefillPerSecond: 4
    }
  },
  {
    capability: 'file',
    operation: 'write',
    limits: {
      maxRequestBytes: MOBILE_WEB_FILE_EDIT_MAX_BASE64_CHARACTERS + 4096,
      maxResponseBytes: 2048,
      maxConcurrent: 1,
      rateCapacity: 3,
      rateRefillPerSecond: 0.5
    }
  },
  {
    capability: 'file',
    operation: 'markdownRead',
    limits: {
      maxRequestBytes: 4096,
      maxResponseBytes: MOBILE_WEB_MARKDOWN_CONTENT_MAX_BASE64_CHARACTERS + 4096,
      maxConcurrent: 2,
      rateCapacity: 8,
      rateRefillPerSecond: 2
    }
  },
  {
    capability: 'file',
    operation: 'markdownSave',
    limits: {
      maxRequestBytes: MOBILE_WEB_MARKDOWN_CONTENT_MAX_BASE64_CHARACTERS + 4096,
      maxResponseBytes: MOBILE_WEB_MARKDOWN_CONTENT_MAX_BASE64_CHARACTERS + 4096,
      maxConcurrent: 1,
      rateCapacity: 3,
      rateRefillPerSecond: 0.5
    }
  },
  {
    capability: 'file',
    operation: 'markdownDraftRead',
    limits: {
      maxRequestBytes: 4096,
      maxResponseBytes: MOBILE_WEB_MARKDOWN_CONTENT_MAX_BASE64_CHARACTERS + 4096,
      maxConcurrent: 2,
      rateCapacity: 8,
      rateRefillPerSecond: 2
    }
  },
  {
    capability: 'file',
    operation: 'markdownDraftWrite',
    limits: {
      maxRequestBytes: MOBILE_WEB_MARKDOWN_CONTENT_MAX_BASE64_CHARACTERS + 4096,
      maxResponseBytes: 256,
      maxConcurrent: 1,
      rateCapacity: 12,
      rateRefillPerSecond: 4
    }
  },
  {
    capability: 'file',
    operation: 'open',
    limits: {
      maxRequestBytes: 4096,
      maxResponseBytes: 256,
      maxConcurrent: 1,
      rateCapacity: 8,
      rateRefillPerSecond: 2
    }
  },
  {
    capability: 'file',
    operation: 'resolveTerminalPath',
    limits: {
      maxRequestBytes: 4096,
      maxResponseBytes: 4096,
      maxConcurrent: 2,
      rateCapacity: 12,
      rateRefillPerSecond: 4
    }
  },
  {
    capability: 'file',
    operation: 'readTerminalArtifactChunk',
    limits: {
      maxRequestBytes: 4096,
      maxResponseBytes: MOBILE_WEB_FILE_CHUNK_MAX_BASE64_CHARS + 4096,
      maxConcurrent: 2,
      rateCapacity: 16,
      rateRefillPerSecond: 4
    }
  },
  {
    capability: 'file',
    operation: 'releaseTerminalArtifact',
    limits: {
      maxRequestBytes: 2048,
      maxResponseBytes: 256,
      maxConcurrent: 2,
      rateCapacity: 24,
      rateRefillPerSecond: 8
    }
  }
] as const satisfies readonly MobileWebFileOperationGrant[]
