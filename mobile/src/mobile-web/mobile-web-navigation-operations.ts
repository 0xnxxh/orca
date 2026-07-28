import {
  MobileWebNavigationReconnectPayloadSchema,
  MobileWebNavigationRemoveHostPayloadSchema,
  MobileWebNavigationRoutePayloadSchema
} from '../../../src/shared/mobile-web/navigation-operation-contract'
import { MobileWebBrokerError } from './mobile-web-broker-error'

export type MobileWebNavigationAuthority = {
  route(
    destination: 'hostPicker' | 'pairingRepair' | 'terminalSettings',
    requestId: string
  ): void | Promise<void>
  reconnect(): void | Promise<void>
  removeHost(): void | Promise<void>
  consumeRecentUserGesture(): boolean
}

export async function executeMobileWebNavigationOperation(args: {
  requestId: string
  operation: string
  payload: unknown
  authority: MobileWebNavigationAuthority | undefined
}): Promise<null> {
  if (!args.authority) {
    throw new MobileWebBrokerError('unavailable')
  }
  if (args.operation === 'route') {
    const payload = MobileWebNavigationRoutePayloadSchema.parse(args.payload)
    if (payload.destination === 'terminalSettings' && !args.authority.consumeRecentUserGesture()) {
      throw new MobileWebBrokerError('permission_required')
    }
    await args.authority.route(payload.destination, args.requestId)
    return null
  }
  if (args.operation === 'reconnect') {
    MobileWebNavigationReconnectPayloadSchema.parse(args.payload)
    if (!args.authority.consumeRecentUserGesture()) {
      throw new MobileWebBrokerError('permission_required')
    }
    await args.authority.reconnect()
    return null
  }
  if (args.operation === 'removeHost') {
    MobileWebNavigationRemoveHostPayloadSchema.parse(args.payload)
    if (!args.authority.consumeRecentUserGesture()) {
      throw new MobileWebBrokerError('permission_required')
    }
    await args.authority.removeHost()
    return null
  }
  throw new MobileWebBrokerError('unsupported_capability')
}
