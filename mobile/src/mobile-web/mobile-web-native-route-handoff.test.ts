import { describe, expect, it, vi } from 'vitest'
import { MOBILE_WEB_BRIDGE_PROTOCOL_VERSION } from '../../../src/shared/mobile-web/bridge-contract'
import { MobileWebCapabilityBroker } from './mobile-web-capability-broker'
import {
  completeMobileWebNativeRouteHandoffAfterResponse,
  MobileWebNativeRouteHandoff
} from './mobile-web-native-route-handoff'

const CONTEXT = {
  shellSessionId: 'S'.repeat(43),
  buildId: 'a'.repeat(64)
}

describe('mobile web native route handoff', () => {
  it('posts the broker response before scheduling navigation', async () => {
    const events: string[] = []
    const handoff = new MobileWebNativeRouteHandoff()
    const requestId = 'R'.repeat(22)
    let resolveDeactivation: (() => void) | undefined
    const deactivation = new Promise<void>((resolve) => {
      resolveDeactivation = resolve
    })
    const broker = new MobileWebCapabilityBroker({
      context: CONTEXT,
      getClient: () => null,
      isConnected: () => false,
      isActive: () => true,
      nativeAuthority: nativeAuthority(),
      navigationAuthority: {
        route(destination, routedRequestId) {
          events.push('record')
          if (destination === 'terminalSettings') {
            handoff.record(routedRequestId, destination)
          }
        },
        reconnect: vi.fn(),
        removeHost: vi.fn(),
        consumeRecentUserGesture: () => true
      },
      terminalClientId: 'native-only-device',
      randomBytes: (length) => new Uint8Array(length),
      postMessage(message) {
        expect(message).toMatchObject({ type: 'response', requestId, status: 'success' })
        events.push('response')
      }
    })

    await broker.handle({
      version: MOBILE_WEB_BRIDGE_PROTOCOL_VERSION,
      type: 'request',
      shellSessionId: CONTEXT.shellSessionId,
      buildId: CONTEXT.buildId,
      requestId,
      mode: 'once',
      capability: 'navigation',
      operation: 'route',
      payload: { destination: 'terminalSettings' }
    })

    let scheduled: (() => Promise<void>) | undefined
    expect(events).toEqual(['record', 'response'])
    expect(
      completeMobileWebNativeRouteHandoffAfterResponse({
        handoff,
        requestId,
        deactivateSessionView: () => {
          events.push('deactivate')
          return deactivation
        },
        setHostedViewActive: (active) => events.push(`active:${active}`),
        navigate: () => events.push('navigate'),
        schedule(callback) {
          expect(handoff.consume(requestId)).toBeNull()
          events.push('schedule')
          scheduled = callback
        }
      })
    ).toBe(true)
    expect(events).toEqual(['record', 'response', 'schedule'])
    const completion = scheduled?.()
    expect(events).toEqual(['record', 'response', 'schedule', 'active:false', 'deactivate'])
    resolveDeactivation?.()
    await completion
    expect(events).toEqual([
      'record',
      'response',
      'schedule',
      'active:false',
      'deactivate',
      'navigate'
    ])
    broker.dispose()
  })

  it('reactivates the hosted view when native deactivation fails', async () => {
    const events: string[] = []
    const handoff = new MobileWebNativeRouteHandoff()
    const requestId = 'F'.repeat(22)
    handoff.record(requestId, 'terminalSettings')
    let scheduled: (() => Promise<void>) | undefined

    completeMobileWebNativeRouteHandoffAfterResponse({
      handoff,
      requestId,
      deactivateSessionView: async () => {
        events.push('deactivate')
        throw new Error('native failure')
      },
      setHostedViewActive: (active) => events.push(`active:${active}`),
      navigate: () => events.push('navigate'),
      onFailure: () => events.push('failure'),
      schedule: (callback) => {
        scheduled = callback
      }
    })

    await scheduled?.()
    expect(events).toEqual(['active:false', 'deactivate', 'active:true', 'failure'])
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
