import { MOBILE_WEB_BRIDGE_MAX_OPERATION_BYTES } from '../../../src/shared/mobile-web/bridge-limits'
import { MOBILE_WEB_DIFF_LINE_MAX_CHARACTERS } from '../../../src/shared/mobile-web/source-control-operation-contract'
import type { MobileWebOperationGrant } from './mobile-web-production-grants'

export const MOBILE_WEB_PRODUCTION_SOURCE_CONTROL_REVIEW_GRANTS = [
  {
    capability: 'sourceControl',
    operation: 'reviewMetadata',
    limits: {
      maxRequestBytes: 2048,
      maxResponseBytes: MOBILE_WEB_BRIDGE_MAX_OPERATION_BYTES,
      maxConcurrent: 2,
      rateCapacity: 8,
      rateRefillPerSecond: 2
    }
  },
  {
    capability: 'sourceControl',
    operation: 'reviewMetadataUpdate',
    limits: {
      maxRequestBytes: MOBILE_WEB_BRIDGE_MAX_OPERATION_BYTES,
      maxResponseBytes: MOBILE_WEB_BRIDGE_MAX_OPERATION_BYTES,
      maxConcurrent: 1,
      rateCapacity: 8,
      rateRefillPerSecond: 2
    }
  },
  {
    capability: 'sourceControl',
    operation: 'reviewLink',
    limits: {
      maxRequestBytes: 2048,
      maxResponseBytes: 2048,
      maxConcurrent: 2,
      rateCapacity: 8,
      rateRefillPerSecond: 2
    }
  },
  {
    capability: 'sourceControl',
    operation: 'reviewLinkUpdate',
    limits: {
      maxRequestBytes: 4096,
      maxResponseBytes: 2048,
      maxConcurrent: 1,
      rateCapacity: 4,
      rateRefillPerSecond: 1
    }
  },
  {
    capability: 'sourceControl',
    operation: 'reviewDiff',
    limits: {
      maxRequestBytes: 8192,
      maxResponseBytes: 192 * 1024 + MOBILE_WEB_DIFF_LINE_MAX_CHARACTERS,
      maxConcurrent: 2,
      rateCapacity: 12,
      rateRefillPerSecond: 3
    }
  },
  {
    capability: 'sourceControl',
    operation: 'reviewOpen',
    limits: {
      maxRequestBytes: 4096,
      maxResponseBytes: 256,
      maxConcurrent: 1,
      rateCapacity: 8,
      rateRefillPerSecond: 2
    }
  },
  {
    capability: 'sourceControl',
    operation: 'reviewTerminalSend',
    limits: {
      maxRequestBytes: 128 * 1024,
      maxResponseBytes: 256,
      maxConcurrent: 1,
      rateCapacity: 4,
      rateRefillPerSecond: 1
    }
  }
] as const satisfies readonly MobileWebOperationGrant[]
