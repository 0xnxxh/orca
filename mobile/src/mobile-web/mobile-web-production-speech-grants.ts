import type { MobileWebBridgeShellMessage } from '../../../src/shared/mobile-web/bridge-contract'

type MobileWebSpeechOperationGrant = Extract<
  MobileWebBridgeShellMessage,
  { type: 'init' }
>['grants'][number]

export const MOBILE_WEB_PRODUCTION_SPEECH_GRANTS = [
  {
    capability: 'speech',
    operation: 'subscribe',
    limits: {
      maxRequestBytes: 256,
      maxResponseBytes: 256,
      maxConcurrent: 1,
      rateCapacity: 4,
      rateRefillPerSecond: 1
    }
  },
  {
    capability: 'speech',
    operation: 'setup',
    limits: {
      maxRequestBytes: 256,
      maxResponseBytes: 32 * 1024,
      maxConcurrent: 1,
      rateCapacity: 8,
      rateRefillPerSecond: 2
    }
  },
  {
    capability: 'speech',
    operation: 'downloadModel',
    limits: {
      maxRequestBytes: 512,
      maxResponseBytes: 256,
      maxConcurrent: 1,
      rateCapacity: 3,
      rateRefillPerSecond: 0.25
    }
  },
  {
    capability: 'speech',
    operation: 'deleteModel',
    limits: {
      maxRequestBytes: 512,
      maxResponseBytes: 32 * 1024,
      maxConcurrent: 1,
      rateCapacity: 3,
      rateRefillPerSecond: 0.25
    }
  },
  {
    capability: 'speech',
    operation: 'configure',
    limits: {
      maxRequestBytes: 1024,
      maxResponseBytes: 32 * 1024,
      maxConcurrent: 1,
      rateCapacity: 6,
      rateRefillPerSecond: 1
    }
  },
  {
    capability: 'speech',
    operation: 'start',
    limits: {
      maxRequestBytes: 256,
      maxResponseBytes: 512,
      maxConcurrent: 1,
      rateCapacity: 4,
      rateRefillPerSecond: 0.5
    }
  },
  {
    capability: 'speech',
    operation: 'stop',
    limits: {
      maxRequestBytes: 256,
      maxResponseBytes: 48 * 1024,
      maxConcurrent: 1,
      rateCapacity: 4,
      rateRefillPerSecond: 0.5
    }
  },
  {
    capability: 'speech',
    operation: 'cancel',
    limits: {
      maxRequestBytes: 256,
      maxResponseBytes: 256,
      maxConcurrent: 1,
      rateCapacity: 8,
      rateRefillPerSecond: 2
    }
  }
] as const satisfies readonly MobileWebSpeechOperationGrant[]
