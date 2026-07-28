import type { MobileWebBridgeShellMessage } from '../../../src/shared/mobile-web/bridge-contract'

type MobileWebTerminalOperationGrant = Extract<
  MobileWebBridgeShellMessage,
  { type: 'init' }
>['grants'][number]

export const MOBILE_WEB_PRODUCTION_TERMINAL_GRANTS = [
  {
    capability: 'terminal',
    operation: 'clipboardPaste',
    limits: {
      maxRequestBytes: 1024,
      maxResponseBytes: 256,
      maxConcurrent: 1,
      rateCapacity: 4,
      rateRefillPerSecond: 1
    }
  },
  {
    capability: 'terminal',
    operation: 'attachImage',
    limits: {
      maxRequestBytes: 1024,
      maxResponseBytes: 256,
      maxConcurrent: 1,
      rateCapacity: 3,
      rateRefillPerSecond: 0.5
    }
  },
  {
    capability: 'terminal',
    operation: 'subscribe',
    limits: {
      maxRequestBytes: 4096,
      maxResponseBytes: 1024,
      maxConcurrent: 4,
      rateCapacity: 8,
      rateRefillPerSecond: 2
    }
  },
  {
    capability: 'terminal',
    operation: 'input',
    limits: {
      maxRequestBytes: 32 * 1024,
      maxResponseBytes: 256,
      maxConcurrent: 8,
      rateCapacity: 120,
      rateRefillPerSecond: 120
    }
  },
  {
    capability: 'terminal',
    operation: 'queryReply',
    limits: {
      maxRequestBytes: 32 * 1024,
      maxResponseBytes: 256,
      maxConcurrent: 8,
      rateCapacity: 120,
      rateRefillPerSecond: 120
    }
  },
  {
    capability: 'terminal',
    operation: 'resize',
    limits: {
      maxRequestBytes: 1024,
      maxResponseBytes: 256,
      maxConcurrent: 2,
      rateCapacity: 30,
      rateRefillPerSecond: 15
    }
  },
  {
    capability: 'terminal',
    operation: 'visibility',
    limits: {
      maxRequestBytes: 1024,
      maxResponseBytes: 256,
      maxConcurrent: 2,
      rateCapacity: 12,
      rateRefillPerSecond: 4
    }
  },
  {
    capability: 'terminal',
    operation: 'displayMode',
    limits: {
      maxRequestBytes: 1024,
      maxResponseBytes: 256,
      maxConcurrent: 1,
      rateCapacity: 6,
      rateRefillPerSecond: 2
    }
  },
  {
    capability: 'terminal',
    operation: 'clear',
    limits: {
      maxRequestBytes: 512,
      maxResponseBytes: 256,
      maxConcurrent: 1,
      rateCapacity: 4,
      rateRefillPerSecond: 1
    }
  },
  {
    capability: 'terminal',
    operation: 'rename',
    limits: {
      maxRequestBytes: 1024,
      maxResponseBytes: 256,
      maxConcurrent: 1,
      rateCapacity: 4,
      rateRefillPerSecond: 1
    }
  },
  {
    capability: 'terminal',
    operation: 'resync',
    limits: {
      maxRequestBytes: 1024,
      maxResponseBytes: 256,
      maxConcurrent: 1,
      rateCapacity: 4,
      rateRefillPerSecond: 1
    }
  },
  {
    capability: 'terminal',
    operation: 'ack',
    limits: {
      maxRequestBytes: 1024,
      maxResponseBytes: 256,
      maxConcurrent: 8,
      rateCapacity: 240,
      rateRefillPerSecond: 240
    }
  },
  {
    capability: 'terminal',
    operation: 'cancel',
    limits: {
      maxRequestBytes: 1024,
      maxResponseBytes: 256,
      maxConcurrent: 2,
      rateCapacity: 12,
      rateRefillPerSecond: 4
    }
  }
] as const satisfies readonly MobileWebTerminalOperationGrant[]
