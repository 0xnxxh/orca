import type { MobileWebBridgeShellMessage } from '../../../src/shared/mobile-web/bridge-contract'

type MobileWebNavigationOperationGrant = Extract<
  MobileWebBridgeShellMessage,
  { type: 'init' }
>['grants'][number]

export const MOBILE_WEB_PRODUCTION_NAVIGATION_GRANTS = [
  {
    capability: 'navigation',
    operation: 'route',
    limits: {
      maxRequestBytes: 256,
      maxResponseBytes: 256,
      maxConcurrent: 1,
      rateCapacity: 8,
      rateRefillPerSecond: 2
    }
  },
  {
    capability: 'navigation',
    operation: 'reconnect',
    limits: {
      maxRequestBytes: 256,
      maxResponseBytes: 256,
      maxConcurrent: 1,
      rateCapacity: 4,
      rateRefillPerSecond: 1
    }
  },
  {
    capability: 'navigation',
    operation: 'removeHost',
    limits: {
      maxRequestBytes: 256,
      maxResponseBytes: 256,
      maxConcurrent: 1,
      rateCapacity: 2,
      rateRefillPerSecond: 0.25
    }
  }
] as const satisfies readonly MobileWebNavigationOperationGrant[]
