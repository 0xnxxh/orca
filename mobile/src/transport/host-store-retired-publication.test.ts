import { beforeEach, describe, expect, it, vi } from 'vitest'

const storage = vi.hoisted(() => ({ getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() }))
const secureStore = vi.hoisted(() => ({
  deleteItemAsync: vi.fn(),
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn()
}))
const scheduleCleanup = vi.hoisted(() => vi.fn())

vi.mock('@react-native-async-storage/async-storage', () => ({ default: storage }))
vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  ...secureStore
}))
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }))
vi.mock('./host-credential-cleanup', () => ({
  scheduleHostCredentialCleanup: (...args: unknown[]) => scheduleCleanup(...args),
  retryPendingHostCredentialCleanups: vi.fn()
}))

import { removeHost, resetHostStoreForTests, saveHost } from './host-store'
import { publishHostProfileTransaction } from './host-profile-publication'

const HOST = {
  id: 'host-1',
  name: 'Host 1',
  endpoint: 'ws://127.0.0.1:1',
  publicKeyB64: 'key',
  lastConnected: 0
}
const HOSTS_STORAGE_KEY = 'orca:hosts'

describe('host removal with a retired publication', () => {
  let storedHostsRaw: string

  beforeEach(() => {
    vi.clearAllMocks()
    resetHostStoreForTests()
    storedHostsRaw = JSON.stringify([HOST])
    storage.getItem.mockImplementation(async (key: string) =>
      key === HOSTS_STORAGE_KEY ? storedHostsRaw : null
    )
    storage.setItem.mockImplementation(async (key: string, raw: string) => {
      if (key === HOSTS_STORAGE_KEY) {
        storedHostsRaw = raw
      }
    })
    secureStore.getItemAsync.mockResolvedValue('token-1')
    scheduleCleanup.mockResolvedValue(undefined)
  })

  it('removes metadata without waiting for a stalled retired publication', async () => {
    let markPublicationStarted: (() => void) | null = null
    const publicationStarted = new Promise<void>((resolve) => {
      markPublicationStarted = resolve
    })
    const stalledPublication = publishHostProfileTransaction(
      { ...HOST, deviceToken: 'token-1' },
      async () => {
        markPublicationStarted?.()
        await new Promise<void>(() => {})
      },
      saveHost
    )
    void stalledPublication.catch(() => {})
    await publicationStarted

    await expect(removeHost(HOST.id)).resolves.toBeUndefined()

    expect(JSON.parse(storedHostsRaw)).toEqual([])
    expect(scheduleCleanup).toHaveBeenCalledOnce()
  })
})
