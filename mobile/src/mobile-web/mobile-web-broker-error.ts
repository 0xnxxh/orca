import type { MobileWebBridgeErrorCode } from '../../../src/shared/mobile-web/bridge-contract'
import { MobileWebSessionSubscriptionError } from './mobile-web-session-subscriptions'

export class MobileWebBrokerError extends Error {
  constructor(readonly code: MobileWebBridgeErrorCode) {
    super(code)
  }
}

export function mobileWebBridgeErrorCode(error: unknown): MobileWebBridgeErrorCode {
  if (error instanceof MobileWebBrokerError) {
    return error.code
  }
  if (error instanceof MobileWebSessionSubscriptionError) {
    return error.code
  }
  return error instanceof Error && error.name === 'ZodError' ? 'invalid_request' : 'host_error'
}

export function isRetryableMobileWebBridgeError(code: MobileWebBridgeErrorCode): boolean {
  return code === 'not_connected' || code === 'timeout' || code === 'host_error'
}
