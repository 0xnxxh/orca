import { describe, expect, it, vi } from 'vitest'
import {
  parseMobileWebBridgePageMessage,
  parseMobileWebBridgeShellMessage
} from '../../../src/shared/mobile-web/bridge-contract'
import { MobileWebBridgeClient } from '../../../src/mobile-web/src/mobile-web-bridge-client'
import { MobileWebCapabilityBroker } from './mobile-web-capability-broker'
import { MOBILE_WEB_PRODUCTION_NATIVE_GRANTS } from './mobile-web-production-native-grants'

const CONTEXT = {
  shellSessionId: 'S'.repeat(43),
  buildId: 'a'.repeat(64)
}

describe('mobile web native capability round trip', () => {
  it('keeps device effects in the shell behind typed grants and gestures', async () => {
    const hapticFeedback = vi.fn()
    const clipboardWrite = vi.fn().mockResolvedValue({ confirmation: 'in-app' as const })
    const openExternal = vi.fn().mockResolvedValue(undefined)
    const terminalPreferences = vi.fn().mockResolvedValue({
      textScale: 1.25 as const,
      autocompleteEnabled: true,
      linkOpenMode: 'phone-browser' as const
    })
    const terminalAccessoryPreferences = vi.fn().mockResolvedValue({
      customKeys: [{ id: 'custom-1', label: 'Build', bytes: 'pnpm build\r', enter: false }],
      orderedBuiltInIds: ['escape', 'tab'],
      visibleBuiltInIds: ['escape']
    })
    const terminalCustomKeysUpdate = vi.fn().mockResolvedValue(undefined)
    const terminalTextScaleUpdate = vi.fn().mockResolvedValue(undefined)
    const consumeRecentUserGesture = vi.fn(() => true)
    let broker: MobileWebCapabilityBroker
    let requestIndex = 0
    const client = new MobileWebBridgeClient({
      context: CONTEXT,
      grants: [...MOBILE_WEB_PRODUCTION_NATIVE_GRANTS],
      createRequestId: () => String.fromCharCode(65 + requestIndex++).repeat(22),
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
      nativeAuthority: {
        hapticFeedback,
        clipboardWrite,
        openExternal,
        terminalAccessoryPreferences,
        terminalCustomKeysUpdate,
        terminalPreferences,
        terminalTextScaleUpdate
      },
      navigationAuthority: {
        route: vi.fn(),
        reconnect: vi.fn(),
        removeHost: vi.fn(),
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

    await expect(client.native.terminalPreferences()).resolves.toEqual({
      textScale: 1.25,
      autocompleteEnabled: true,
      linkOpenMode: 'phone-browser'
    })
    await expect(client.native.terminalAccessoryPreferences()).resolves.toEqual({
      customKeys: [{ id: 'custom-1', label: 'Build', bytes: 'pnpm build\r', enter: false }],
      orderedBuiltInIds: ['escape', 'tab'],
      visibleBuiltInIds: ['escape']
    })
    await expect(client.native.hapticFeedback('selection')).resolves.toBeNull()
    await expect(client.native.clipboardWrite('selected text')).resolves.toEqual({
      confirmation: 'in-app'
    })
    await expect(client.native.openExternal('https://example.com')).resolves.toBeNull()
    await expect(client.native.terminalTextScaleUpdate(1.5)).resolves.toBeNull()
    await expect(
      client.native.terminalCustomKeysUpdate([
        { id: 'custom-2', label: 'Test', bytes: 'pnpm test\r', enter: false }
      ])
    ).resolves.toBeNull()

    expect(hapticFeedback).toHaveBeenCalledWith('selection')
    expect(clipboardWrite).toHaveBeenCalledWith('selected text')
    expect(openExternal).toHaveBeenCalledWith('https://example.com')
    expect(terminalTextScaleUpdate).toHaveBeenCalledWith(1.5)
    expect(terminalCustomKeysUpdate).toHaveBeenCalledWith([
      { id: 'custom-2', label: 'Test', bytes: 'pnpm test\r', enter: false }
    ])
    expect(consumeRecentUserGesture).toHaveBeenCalledTimes(4)
    client.dispose()
    broker.dispose()
  })
})
