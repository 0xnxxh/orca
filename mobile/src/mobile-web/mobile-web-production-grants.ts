import type { MobileWebBridgeShellMessage } from '../../../src/shared/mobile-web/bridge-contract'
import { MOBILE_WEB_PRODUCTION_BROWSER_GRANTS } from './mobile-web-production-browser-grants'
import { MOBILE_WEB_PRODUCTION_FILE_GRANTS } from './mobile-web-production-file-grants'
import { MOBILE_WEB_PRODUCTION_NAVIGATION_GRANTS } from './mobile-web-production-navigation-grants'
import { MOBILE_WEB_PRODUCTION_NATIVE_GRANTS } from './mobile-web-production-native-grants'
import { MOBILE_WEB_PRODUCTION_NATIVE_CHAT_GRANTS } from './mobile-web-production-native-chat-grants'
import { MOBILE_WEB_PRODUCTION_SESSION_GRANTS } from './mobile-web-production-session-grants'
import { MOBILE_WEB_PRODUCTION_SOURCE_CONTROL_GRANTS } from './mobile-web-production-source-control-grants'
import { MOBILE_WEB_PRODUCTION_SPEECH_GRANTS } from './mobile-web-production-speech-grants'
import { MOBILE_WEB_PRODUCTION_TASK_GRANTS } from './mobile-web-production-task-grants'
import { MOBILE_WEB_PRODUCTION_TERMINAL_GRANTS } from './mobile-web-production-terminal-grants'
import { MOBILE_WEB_PRODUCTION_WORKSPACE_CREATION_GRANTS } from './mobile-web-production-workspace-creation-grants'

export type MobileWebOperationGrant = Extract<
  MobileWebBridgeShellMessage,
  { type: 'init' }
>['grants'][number]

export const MOBILE_WEB_PRODUCTION_GRANTS = [
  {
    capability: 'workspace',
    operation: 'snapshot',
    limits: {
      maxRequestBytes: 1024,
      maxResponseBytes: 128 * 1024,
      maxConcurrent: 2,
      rateCapacity: 4,
      rateRefillPerSecond: 1
    }
  },
  {
    capability: 'workspace',
    operation: 'repositories',
    limits: {
      maxRequestBytes: 256,
      maxResponseBytes: 128 * 1024,
      maxConcurrent: 2,
      rateCapacity: 4,
      rateRefillPerSecond: 1
    }
  },
  {
    capability: 'workspace',
    operation: 'subscribe',
    limits: {
      maxRequestBytes: 256,
      maxResponseBytes: 1024,
      maxConcurrent: 1,
      rateCapacity: 4,
      rateRefillPerSecond: 1
    }
  },
  {
    capability: 'workspace',
    operation: 'activate',
    limits: {
      maxRequestBytes: 1024,
      maxResponseBytes: 1024,
      maxConcurrent: 1,
      rateCapacity: 6,
      rateRefillPerSecond: 2
    }
  },
  {
    capability: 'workspace',
    operation: 'update',
    limits: {
      maxRequestBytes: 1024,
      maxResponseBytes: 1024,
      maxConcurrent: 2,
      rateCapacity: 12,
      rateRefillPerSecond: 4
    }
  },
  {
    capability: 'workspace',
    operation: 'remove',
    limits: {
      maxRequestBytes: 1024,
      maxResponseBytes: 1024,
      maxConcurrent: 1,
      rateCapacity: 4,
      rateRefillPerSecond: 0.5
    }
  },
  {
    capability: 'settings',
    operation: 'snapshot',
    limits: {
      maxRequestBytes: 256,
      maxResponseBytes: 32 * 1024,
      maxConcurrent: 2,
      rateCapacity: 4,
      rateRefillPerSecond: 1
    }
  },
  {
    capability: 'settings',
    operation: 'update',
    limits: {
      maxRequestBytes: 32 * 1024,
      maxResponseBytes: 256,
      maxConcurrent: 1,
      rateCapacity: 8,
      rateRefillPerSecond: 2
    }
  },
  {
    capability: 'account',
    operation: 'snapshot',
    limits: {
      maxRequestBytes: 256,
      maxResponseBytes: 96 * 1024,
      maxConcurrent: 2,
      rateCapacity: 6,
      rateRefillPerSecond: 1
    }
  },
  ...MOBILE_WEB_PRODUCTION_TASK_GRANTS,
  {
    capability: 'account',
    operation: 'select',
    limits: {
      maxRequestBytes: 1024,
      maxResponseBytes: 256,
      maxConcurrent: 1,
      rateCapacity: 4,
      rateRefillPerSecond: 1
    }
  },
  {
    capability: 'account',
    operation: 'resetCreditCapability',
    limits: {
      maxRequestBytes: 256,
      maxResponseBytes: 256,
      maxConcurrent: 2,
      rateCapacity: 4,
      rateRefillPerSecond: 1
    }
  },
  {
    capability: 'account',
    operation: 'consumeResetCredit',
    limits: {
      maxRequestBytes: 8 * 1024,
      maxResponseBytes: 96 * 1024,
      maxConcurrent: 1,
      rateCapacity: 2,
      rateRefillPerSecond: 0.25
    }
  },
  {
    capability: 'account',
    operation: 'subscribe',
    limits: {
      maxRequestBytes: 256,
      maxResponseBytes: 96 * 1024,
      maxConcurrent: 1,
      rateCapacity: 4,
      rateRefillPerSecond: 1
    }
  },
  ...MOBILE_WEB_PRODUCTION_SESSION_GRANTS,
  ...MOBILE_WEB_PRODUCTION_TERMINAL_GRANTS,
  ...MOBILE_WEB_PRODUCTION_BROWSER_GRANTS,
  ...MOBILE_WEB_PRODUCTION_FILE_GRANTS,
  ...MOBILE_WEB_PRODUCTION_SOURCE_CONTROL_GRANTS,
  ...MOBILE_WEB_PRODUCTION_SPEECH_GRANTS,
  ...MOBILE_WEB_PRODUCTION_NATIVE_GRANTS,
  ...MOBILE_WEB_PRODUCTION_NATIVE_CHAT_GRANTS,
  ...MOBILE_WEB_PRODUCTION_NAVIGATION_GRANTS,
  ...MOBILE_WEB_PRODUCTION_WORKSPACE_CREATION_GRANTS,
  {
    capability: 'provider',
    operation: 'review',
    limits: {
      maxRequestBytes: 4096,
      maxResponseBytes: 192 * 1024,
      maxConcurrent: 2,
      rateCapacity: 6,
      rateRefillPerSecond: 1
    }
  },
  {
    capability: 'provider',
    operation: 'reviewCreationEligibility',
    limits: {
      maxRequestBytes: 4096,
      maxResponseBytes: 48 * 1024,
      maxConcurrent: 2,
      rateCapacity: 6,
      rateRefillPerSecond: 1
    }
  },
  {
    capability: 'provider',
    operation: 'reviewCreate',
    limits: {
      maxRequestBytes: 48 * 1024,
      maxResponseBytes: 4096,
      maxConcurrent: 1,
      rateCapacity: 2,
      rateRefillPerSecond: 0.1
    }
  },
  {
    capability: 'provider',
    operation: 'reviewGenerateFields',
    limits: {
      maxRequestBytes: 48 * 1024,
      maxResponseBytes: 48 * 1024,
      maxConcurrent: 1,
      rateCapacity: 2,
      rateRefillPerSecond: 0.1
    }
  },
  {
    capability: 'provider',
    operation: 'reviewDiff',
    limits: {
      maxRequestBytes: 4096,
      maxResponseBytes: 128 * 1024,
      maxConcurrent: 2,
      rateCapacity: 8,
      rateRefillPerSecond: 2
    }
  },
  {
    capability: 'provider',
    operation: 'reviewQuery',
    limits: {
      maxRequestBytes: 4096,
      maxResponseBytes: 192 * 1024,
      maxConcurrent: 2,
      rateCapacity: 6,
      rateRefillPerSecond: 1
    }
  },
  {
    capability: 'provider',
    operation: 'mutateReview',
    limits: {
      maxRequestBytes: 16 * 1024,
      maxResponseBytes: 4096,
      maxConcurrent: 1,
      rateCapacity: 4,
      rateRefillPerSecond: 0.5
    }
  },
  {
    capability: 'provider',
    operation: 'manageReview',
    limits: {
      maxRequestBytes: 16 * 1024,
      maxResponseBytes: 4096,
      maxConcurrent: 1,
      rateCapacity: 4,
      rateRefillPerSecond: 0.5
    }
  },
  {
    capability: 'provider',
    operation: 'submitReview',
    limits: {
      maxRequestBytes: 96 * 1024,
      maxResponseBytes: 8192,
      maxConcurrent: 1,
      rateCapacity: 2,
      rateRefillPerSecond: 0.1
    }
  }
] as const satisfies readonly MobileWebOperationGrant[]
