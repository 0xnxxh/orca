import { describe, expect, it } from 'vitest'
import { HostReconnectProfileCache } from './host-reconnect-profile-cache'
import type { HostProfile } from './types'

const HOST: HostProfile = {
  id: 'host-1',
  name: 'Host 1',
  endpoint: 'ws://127.0.0.1:1',
  deviceToken: 'token',
  publicKeyB64: 'key',
  lastConnected: 0
}

describe('HostReconnectProfileCache', () => {
  it('does not let an invalidated host-list snapshot replace relay routing', () => {
    const cache = new HostReconnectProfileCache()
    const relayHost: HostProfile = {
      ...HOST,
      endpoints: [
        { id: 'direct-primary', kind: 'lan', url: HOST.endpoint },
        { id: 'relay-primary', kind: 'relay', url: 'wss://relay.invalid/v1/connect/host' }
      ],
      relayHostId: 'AbCdEf0123_-xyZ9',
      relay: {
        v: 1,
        directorUrl: 'https://relay.invalid',
        cellUrl: 'https://relay.invalid',
        assignmentEpoch: 1,
        relayHostId: 'AbCdEf0123_-xyZ9',
        e2eeFraming: 2
      }
    }
    cache.prime(HOST, 4)
    const relayVersion = cache.prime(relayHost, 5)

    expect(cache.primeLoaded(HOST, 4, 5)).toBeNull()
    expect(cache.get(HOST.id, 5)).toEqual(relayHost)
    expect(cache.version(HOST.id, 5)).toBe(relayVersion)
  })

  it('invalidates a reconnect profile after its durable source revision changes', () => {
    const cache = new HostReconnectProfileCache()
    const cachedVersion = cache.prime(HOST, 4)

    expect(cache.reconnectProfile(HOST.id, 5)).toEqual({
      host: undefined,
      version: cachedVersion + 1
    })
  })
})
