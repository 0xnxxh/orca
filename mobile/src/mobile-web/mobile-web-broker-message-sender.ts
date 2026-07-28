import type {
  MobileWebBridgeErrorCode,
  MobileWebBridgeMessageContext,
  MobileWebBridgeShellMessage
} from '../../../src/shared/mobile-web/bridge-contract'
import { mobileWebBrokerEnvelope } from './mobile-web-broker-envelope'

export class MobileWebBrokerMessageSender {
  constructor(
    private readonly options: {
      context: MobileWebBridgeMessageContext
      isActive: () => boolean
      postMessage: (message: MobileWebBridgeShellMessage) => void | Promise<void>
    }
  ) {}

  success(requestId: string, payload: unknown): Promise<void> {
    return this.post({
      ...mobileWebBrokerEnvelope(this.options.context),
      type: 'response',
      requestId,
      status: 'success',
      payload
    })
  }

  error(requestId: string, code: MobileWebBridgeErrorCode, retryable: boolean): Promise<void> {
    return this.post({
      ...mobileWebBrokerEnvelope(this.options.context),
      type: 'response',
      requestId,
      status: 'error',
      error: { code, retryable }
    })
  }

  event(subscriptionId: string, sequence: number, payload: unknown): Promise<void> {
    return this.post({
      ...mobileWebBrokerEnvelope(this.options.context),
      type: 'event',
      subscriptionId,
      sequence,
      payload
    })
  }

  private async post(message: MobileWebBridgeShellMessage): Promise<void> {
    if (this.options.isActive()) {
      await this.options.postMessage(message)
    }
  }
}
