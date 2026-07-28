import type { MobileWebBridgeShellMessage } from '../../../src/shared/mobile-web/bridge-contract'

type MobileWebBrowserOperationGrant = Extract<
  MobileWebBridgeShellMessage,
  { type: 'init' }
>['grants'][number]

export const MOBILE_WEB_PRODUCTION_BROWSER_GRANTS = [
  {
    capability: 'browser',
    operation: 'subscribe',
    limits: {
      maxRequestBytes: 4096,
      maxResponseBytes: 1024,
      maxConcurrent: 1,
      rateCapacity: 4,
      rateRefillPerSecond: 1
    }
  },
  {
    capability: 'browser',
    operation: 'navigate',
    limits: {
      maxRequestBytes: 8192,
      maxResponseBytes: 8192,
      maxConcurrent: 1,
      rateCapacity: 8,
      rateRefillPerSecond: 2
    }
  },
  ...(['back', 'forward', 'reload', 'dialog'] as const).map((operation) => ({
    capability: 'browser' as const,
    operation,
    limits: {
      maxRequestBytes: 2048,
      maxResponseBytes: 256,
      maxConcurrent: 2,
      rateCapacity: 12,
      rateRefillPerSecond: 4
    }
  })),
  {
    capability: 'browser',
    operation: 'pointer',
    limits: {
      maxRequestBytes: 4096,
      maxResponseBytes: 256,
      maxConcurrent: 2,
      rateCapacity: 40,
      rateRefillPerSecond: 20
    }
  },
  {
    capability: 'browser',
    operation: 'keyboard',
    limits: {
      maxRequestBytes: 40 * 1024,
      maxResponseBytes: 256,
      maxConcurrent: 2,
      rateCapacity: 20,
      rateRefillPerSecond: 10
    }
  }
] as const satisfies readonly MobileWebBrowserOperationGrant[]
