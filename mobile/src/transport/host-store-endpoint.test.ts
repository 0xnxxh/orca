import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadHosts, resetHostStoreForTests, updateHostNameAndEndpoint } from './host-store'
import { resetMobileRelayHostOverlayStoreForTests } from './mobile-relay-host-overlay-store'

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn()
  }
}))

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY'
}))

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' }
}))

describe('updateHostNameAndEndpoint', () => {
  beforeEach(() => {
    vi.mocked(AsyncStorage.getItem).mockReset()
    vi.mocked(AsyncStorage.setItem).mockReset()
    vi.mocked(SecureStore.getItemAsync).mockReset().mockResolvedValue('device-token')
    resetHostStoreForTests()
    resetMobileRelayHostOverlayStoreForTests()
  })

  const stored = [
    {
      id: 'host-1',
      name: 'Desk',
      endpoint: 'ws://100.64.0.5:6768',
      publicKeyB64: 'pk',
      lastConnected: 1
    },
    {
      id: 'host-2',
      name: 'Laptop',
      endpoint: 'wss://laptop.example:8443',
      publicKeyB64: 'pk-2',
      lastConnected: 2
    }
  ]

  it('commits name and endpoint together in a single write', async () => {
    vi.mocked(AsyncStorage.getItem).mockResolvedValue(JSON.stringify(stored))

    await updateHostNameAndEndpoint('host-1', {
      name: 'Home Desk',
      endpoint: 'ws://192.168.1.10:6768'
    })

    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1)
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      'orca:hosts',
      JSON.stringify([
        { ...stored[0], name: 'Home Desk', endpoint: 'ws://192.168.1.10:6768' },
        stored[1]
      ])
    )
  })

  it('updates only the provided field', async () => {
    vi.mocked(AsyncStorage.getItem).mockResolvedValue(JSON.stringify(stored))

    await updateHostNameAndEndpoint('host-1', { name: 'Home Desk' })

    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      'orca:hosts',
      JSON.stringify([{ ...stored[0], name: 'Home Desk' }, stored[1]])
    )
  })

  it('rewrites only the endpoint when name is omitted', async () => {
    vi.mocked(AsyncStorage.getItem).mockResolvedValue(JSON.stringify(stored))

    await updateHostNameAndEndpoint('host-1', { endpoint: 'ws://192.168.1.10:6768' })

    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      'orca:hosts',
      JSON.stringify([{ ...stored[0], endpoint: 'ws://192.168.1.10:6768' }, stored[1]])
    )
  })

  it('throws and writes nothing when the host is missing', async () => {
    vi.mocked(AsyncStorage.getItem).mockResolvedValue('[]')

    await expect(updateHostNameAndEndpoint('missing', { name: 'Renamed' })).rejects.toThrow(
      'Host not found'
    )
    expect(AsyncStorage.setItem).not.toHaveBeenCalled()
  })

  it('does not commit an endpoint when its relay overlay update fails', async () => {
    const relayHostId = 'AbCdEf0123_-xyZ9'
    const overlay = {
      v: 2,
      hostId: 'host-1',
      endpoints: [
        { id: 'direct-primary', kind: 'lan', url: stored[0]!.endpoint },
        { id: 'relay-primary', kind: 'relay', url: 'wss://relay.onorca.dev/v1/connect/host' }
      ],
      relayHostId,
      relay: {
        v: 1,
        directorUrl: 'https://relay.onorca.dev',
        cellUrl: 'https://relay.onorca.dev',
        assignmentEpoch: 1,
        relayHostId,
        e2eeFraming: 2
      }
    }
    vi.mocked(AsyncStorage.getItem).mockImplementation(async (key) =>
      key === 'orca:mobile-relay:host-overlays:v2'
        ? JSON.stringify([overlay])
        : JSON.stringify(stored)
    )
    vi.mocked(AsyncStorage.setItem).mockImplementation(async (key) => {
      if (key === 'orca:mobile-relay:host-overlays:v2') {
        throw new Error('overlay unavailable')
      }
    })

    await expect(
      updateHostNameAndEndpoint('host-1', { endpoint: 'ws://192.168.1.10:6768' })
    ).rejects.toThrow('overlay unavailable')
    expect(AsyncStorage.setItem).not.toHaveBeenCalledWith('orca:hosts', expect.any(String))
  })

  it('treats the base endpoint as authoritative over an ahead relay overlay', async () => {
    const relayHostId = 'AbCdEf0123_-xyZ9'
    const overlay = {
      v: 2,
      hostId: 'host-1',
      endpoints: [
        { id: 'direct-primary', kind: 'lan', url: 'ws://192.168.1.10:6768' },
        { id: 'relay-primary', kind: 'relay', url: 'wss://relay.onorca.dev/v1/connect/host' }
      ],
      relayHostId,
      relay: {
        v: 1,
        directorUrl: 'https://relay.onorca.dev',
        cellUrl: 'https://relay.onorca.dev',
        assignmentEpoch: 1,
        relayHostId,
        e2eeFraming: 2
      }
    }
    vi.mocked(AsyncStorage.getItem).mockImplementation(async (key) =>
      key === 'orca:mobile-relay:host-overlays:v2'
        ? JSON.stringify([overlay])
        : JSON.stringify(stored)
    )

    const hosts = await loadHosts()

    expect(hosts.find(({ id }) => id === 'host-1')?.endpoints).toContainEqual({
      id: 'direct-primary',
      kind: 'lan',
      url: stored[0]!.endpoint
    })
  })
})
