import { afterEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DaemonClient } from './client'
import { DaemonPtyAdapter } from './daemon-pty-adapter'
import { PROTOCOL_VERSION } from './daemon-protocol-version'

type AdapterInternals = {
  setupEventRouting: () => void
  streamBindings: {
    begin: (nonce: string) => void
    acceptResponse: (
      nonce: string,
      sessionId: string,
      incarnationId: string,
      echoedNonce: string
    ) => boolean
  }
}

afterEach(() => vi.restoreAllMocks())

describe('DaemonPtyAdapter exact output identity', () => {
  it('tags data from the admitted source and keeps a same-id successor after a stale marker', () => {
    const eventListeners: ((event: unknown) => void)[] = []
    vi.spyOn(DaemonClient.prototype, 'onEvent').mockImplementation((listener) => {
      eventListeners.push(listener)
      return () => {}
    })
    const adapter = new DaemonPtyAdapter({
      socketPath: join(tmpdir(), 'orca-daemon-output-incarnation.socket'),
      tokenPath: join(tmpdir(), 'orca-daemon-output-incarnation.token'),
      protocolVersion: PROTOCOL_VERSION
    })
    const received: { id: string; data: string; incarnationId?: string }[] = []
    adapter.onData((payload) => received.push(payload))
    const internals = adapter as unknown as AdapterInternals
    internals.setupEventRouting()

    const emit = (event: string, payload: unknown): void => {
      for (const listener of eventListeners) {
        listener({ type: 'event', event, sessionId: 'reused-session', payload })
      }
    }
    const bind = (incarnationId: string, nonce: string): void => {
      internals.streamBindings.begin(nonce)
      emit('sessionSource', { incarnationId, streamBindingNonce: nonce })
      expect(
        internals.streamBindings.acceptResponse(nonce, 'reused-session', incarnationId, nonce)
      ).toBe(true)
    }

    emit('data', { data: 'unbound' })
    bind('incarnation-a', 'nonce-a')
    emit('data', { data: 'first' })
    bind('incarnation-b', 'nonce-b')
    emit('data', { data: 'successor' })
    emit('sessionSource', { incarnationId: 'incarnation-a', streamBindingNonce: 'nonce-a' })
    emit('data', { data: 'after-stale-marker' })

    expect(received).toEqual([
      { id: 'reused-session', data: 'first', incarnationId: 'incarnation-a' },
      { id: 'reused-session', data: 'successor', incarnationId: 'incarnation-b' },
      { id: 'reused-session', data: 'after-stale-marker', incarnationId: 'incarnation-b' }
    ])
    adapter.dispose()
  })
})
