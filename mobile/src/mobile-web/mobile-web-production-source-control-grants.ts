import { MOBILE_WEB_DIFF_LINE_MAX_CHARACTERS } from '../../../src/shared/mobile-web/source-control-operation-contract'
import {
  MOBILE_WEB_SOURCE_CONTROL_COMPARE_RESPONSE_MAX_BYTES,
  MOBILE_WEB_SOURCE_CONTROL_HISTORY_RESPONSE_MAX_BYTES
} from '../../../src/shared/mobile-web/source-control-history-contract'
import type { MobileWebOperationGrant } from './mobile-web-production-grants'
import { MOBILE_WEB_PRODUCTION_SOURCE_CONTROL_REVIEW_GRANTS } from './mobile-web-production-source-control-review-grants'

export const MOBILE_WEB_PRODUCTION_SOURCE_CONTROL_GRANTS = [
  {
    capability: 'sourceControl',
    operation: 'status',
    limits: {
      maxRequestBytes: 2048,
      maxResponseBytes: 192 * 1024,
      maxConcurrent: 2,
      rateCapacity: 8,
      rateRefillPerSecond: 2
    }
  },
  {
    capability: 'sourceControl',
    operation: 'subscribe',
    limits: {
      maxRequestBytes: 2048,
      maxResponseBytes: 2048,
      maxConcurrent: 1,
      rateCapacity: 4,
      rateRefillPerSecond: 1
    }
  },
  {
    capability: 'sourceControl',
    operation: 'diff',
    limits: {
      maxRequestBytes: 4096,
      maxResponseBytes: 192 * 1024 + MOBILE_WEB_DIFF_LINE_MAX_CHARACTERS,
      maxConcurrent: 2,
      rateCapacity: 12,
      rateRefillPerSecond: 3
    }
  },
  {
    capability: 'sourceControl',
    operation: 'branches',
    limits: {
      maxRequestBytes: 2048,
      maxResponseBytes: 64 * 1024,
      maxConcurrent: 2,
      rateCapacity: 8,
      rateRefillPerSecond: 2
    }
  },
  {
    capability: 'sourceControl',
    operation: 'history',
    limits: {
      maxRequestBytes: 4096,
      maxResponseBytes: MOBILE_WEB_SOURCE_CONTROL_HISTORY_RESPONSE_MAX_BYTES,
      maxConcurrent: 2,
      rateCapacity: 6,
      rateRefillPerSecond: 1
    }
  },
  {
    capability: 'sourceControl',
    operation: 'branchCompare',
    limits: {
      maxRequestBytes: 4096,
      maxResponseBytes: MOBILE_WEB_SOURCE_CONTROL_COMPARE_RESPONSE_MAX_BYTES,
      maxConcurrent: 2,
      rateCapacity: 8,
      rateRefillPerSecond: 2
    }
  },
  {
    capability: 'sourceControl',
    operation: 'commitCompare',
    limits: {
      maxRequestBytes: 4096,
      maxResponseBytes: MOBILE_WEB_SOURCE_CONTROL_COMPARE_RESPONSE_MAX_BYTES,
      maxConcurrent: 2,
      rateCapacity: 12,
      rateRefillPerSecond: 3
    }
  },
  ...MOBILE_WEB_PRODUCTION_SOURCE_CONTROL_REVIEW_GRANTS,
  {
    capability: 'sourceControl',
    operation: 'stage',
    limits: {
      maxRequestBytes: 96 * 1024,
      maxResponseBytes: 40 * 1024,
      maxConcurrent: 1,
      rateCapacity: 8,
      rateRefillPerSecond: 4
    }
  },
  {
    capability: 'sourceControl',
    operation: 'unstage',
    limits: {
      maxRequestBytes: 96 * 1024,
      maxResponseBytes: 40 * 1024,
      maxConcurrent: 1,
      rateCapacity: 8,
      rateRefillPerSecond: 4
    }
  },
  {
    capability: 'sourceControl',
    operation: 'discard',
    limits: {
      maxRequestBytes: 96 * 1024,
      maxResponseBytes: 40 * 1024,
      maxConcurrent: 1,
      rateCapacity: 4,
      rateRefillPerSecond: 1
    }
  },
  {
    capability: 'sourceControl',
    operation: 'commit',
    limits: {
      maxRequestBytes: 96 * 1024,
      maxResponseBytes: 8 * 1024,
      maxConcurrent: 1,
      rateCapacity: 4,
      rateRefillPerSecond: 1
    }
  },
  {
    capability: 'sourceControl',
    operation: 'generateCommitMessage',
    limits: {
      maxRequestBytes: 96 * 1024,
      maxResponseBytes: 16 * 1024,
      maxConcurrent: 1,
      rateCapacity: 4,
      rateRefillPerSecond: 0.25
    }
  },
  {
    capability: 'sourceControl',
    operation: 'cancelCommitMessageGeneration',
    limits: {
      maxRequestBytes: 2048,
      maxResponseBytes: 2048,
      maxConcurrent: 2,
      rateCapacity: 8,
      rateRefillPerSecond: 4
    }
  },
  {
    capability: 'sourceControl',
    operation: 'upstream',
    limits: {
      maxRequestBytes: 2048,
      maxResponseBytes: 8 * 1024,
      maxConcurrent: 2,
      rateCapacity: 8,
      rateRefillPerSecond: 2
    }
  },
  {
    capability: 'sourceControl',
    operation: 'branch',
    limits: {
      maxRequestBytes: 4096,
      maxResponseBytes: 8 * 1024,
      maxConcurrent: 1,
      rateCapacity: 4,
      rateRefillPerSecond: 1
    }
  },
  {
    capability: 'sourceControl',
    operation: 'fetch',
    limits: {
      maxRequestBytes: 4096,
      maxResponseBytes: 8 * 1024,
      maxConcurrent: 1,
      rateCapacity: 4,
      rateRefillPerSecond: 1
    }
  },
  {
    capability: 'sourceControl',
    operation: 'pull',
    limits: {
      maxRequestBytes: 8192,
      maxResponseBytes: 8 * 1024,
      maxConcurrent: 1,
      rateCapacity: 3,
      rateRefillPerSecond: 0.5
    }
  },
  {
    capability: 'sourceControl',
    operation: 'push',
    limits: {
      maxRequestBytes: 8192,
      maxResponseBytes: 8 * 1024,
      maxConcurrent: 1,
      rateCapacity: 3,
      rateRefillPerSecond: 0.5
    }
  },
  {
    capability: 'sourceControl',
    operation: 'rebase',
    limits: {
      maxRequestBytes: 8192,
      maxResponseBytes: 8 * 1024,
      maxConcurrent: 1,
      rateCapacity: 2,
      rateRefillPerSecond: 0.25
    }
  },
  {
    capability: 'sourceControl',
    operation: 'abort',
    limits: {
      maxRequestBytes: 4096,
      maxResponseBytes: 8 * 1024,
      maxConcurrent: 1,
      rateCapacity: 4,
      rateRefillPerSecond: 1
    }
  }
] as const satisfies readonly MobileWebOperationGrant[]
