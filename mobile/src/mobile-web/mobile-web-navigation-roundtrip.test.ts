import { describe, expect, it, vi } from 'vitest'
import {
  parseMobileWebBridgePageMessage,
  parseMobileWebBridgeShellMessage
} from '../../../src/shared/mobile-web/bridge-contract'
import { MobileWebBridgeClient } from '../../../src/mobile-web/src/mobile-web-bridge-client'
import { MobileWebCapabilityBroker } from './mobile-web-capability-broker'
import { MOBILE_WEB_PRODUCTION_NAVIGATION_GRANTS } from './mobile-web-production-navigation-grants'

const CONTEXT = {
  shellSessionId: 'S'.repeat(43),
  buildId: 'a'.repeat(64)
}

describe('mobile web navigation round trip', () => {
  it('carries named shell intent without host identity', async () => {
    const route = vi.fn()
    const reconnect = vi.fn()
    const removeHost = vi.fn()
    const consumeRecentUserGesture = vi.fn(() => true)
    let broker: MobileWebCapabilityBroker
    let requestIndex = 0
    const client = new MobileWebBridgeClient({
      context: CONTEXT,
      grants: [...MOBILE_WEB_PRODUCTION_NAVIGATION_GRANTS],
      createRequestId: () => String.fromCharCode(82 + requestIndex++).repeat(22),
      postMessage(message) {
        const parsed = parseMobileWebBridgePageMessage(JSON.stringify(message), CONTEXT)
        if (!parsed.ok) {
          return false
        }
        void broker.handle(parsed.value)
        return true
      }
    })
    broker = new MobileWebCapabilityBroker({
      context: CONTEXT,
      getClient: () => null,
      isConnected: () => false,
      isActive: () => true,
      nativeAuthority: nativeAuthority(),
      navigationAuthority: {
        route,
        reconnect,
        removeHost,
        consumeRecentUserGesture
      },
      terminalClientId: 'native-only-device',
      randomBytes: (length) => new Uint8Array(length),
      postMessage(message) {
        const parsed = parseMobileWebBridgeShellMessage(JSON.stringify(message), CONTEXT)
        if (!parsed.ok) {
          throw new Error(parsed.error)
        }
        client.receive(parsed.value)
      }
    })

    await expect(client.navigationRoute({ destination: 'hostPicker' })).resolves.toBeNull()
    await expect(client.navigationRoute({ destination: 'terminalSettings' })).resolves.toBeNull()
    await expect(client.navigationReconnect()).resolves.toBeNull()
    await expect(
      client.navigationRemoveHost({ confirmation: 'remove-paired-host' })
    ).resolves.toBeNull()

    expect(route).toHaveBeenCalledWith('hostPicker', 'R'.repeat(22))
    expect(route).toHaveBeenCalledWith('terminalSettings', 'S'.repeat(22))
    expect(reconnect).toHaveBeenCalledWith()
    expect(removeHost).toHaveBeenCalledWith()
    expect(consumeRecentUserGesture).toHaveBeenCalledTimes(3)
    client.dispose()
    broker.dispose()
  })
})

function nativeAuthority() {
  return {
    hapticFeedback: vi.fn(),
    clipboardWrite: vi.fn(),
    openExternal: vi.fn(),
    terminalPreferences: vi.fn(),
    terminalTextScaleUpdate: vi.fn()
  }
}
