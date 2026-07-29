import { beforeEach, describe, expect, it, vi } from 'vitest'

const asyncStorageMock = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn()
}))

const secureStoreMock = vi.hoisted(() => ({
  deleteItemAsync: vi.fn(),
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn()
}))

vi.mock('@react-native-async-storage/async-storage', () => ({ default: asyncStorageMock }))

vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  ...secureStoreMock
}))

import {
  deleteHostTokenFromKeychain,
  readHostTokenFromKeychain,
  resetHostTokenKeychainForTests,
  writeHostTokenToKeychain
} from './host-token-keychain'

const GENERATION_KEY = 'orca:host-token-keychain-generation'
const TOKEN_KEY = 'orca.host-token.host-1782629088232'

// Why: the exact Android failure from #6600 — expo maps a null-message GeneralSecurityException to this.
const ENCRYPT_REJECTION = new Error(
  `Could not encrypt the value for key '${TOKEN_KEY}' under keychain 'key_v1'. Caused by: unknown`
)

type Options = { keychainService?: string } | undefined

function serviceOf(options: Options): string | undefined {
  return options?.keychainService
}

describe('host token keychain', () => {
  let generationRecord: string | null

  beforeEach(() => {
    vi.clearAllMocks()
    resetHostTokenKeychainForTests()
    generationRecord = null
    asyncStorageMock.getItem.mockImplementation(async (key: string) =>
      key === GENERATION_KEY ? generationRecord : null
    )
    asyncStorageMock.setItem.mockImplementation(async (key: string, raw: string) => {
      if (key === GENERATION_KEY) {
        generationRecord = raw
      }
    })
    secureStoreMock.setItemAsync.mockResolvedValue(undefined)
    secureStoreMock.deleteItemAsync.mockResolvedValue(undefined)
    secureStoreMock.getItemAsync.mockResolvedValue(null)
  })

  it('writes under the default keychain service so existing installs keep their tokens', async () => {
    await writeHostTokenToKeychain(TOKEN_KEY, 'token')

    expect(secureStoreMock.setItemAsync).toHaveBeenCalledTimes(1)
    const [key, value, options] = secureStoreMock.setItemAsync.mock.calls[0]!
    expect(key).toBe(TOKEN_KEY)
    expect(value).toBe('token')
    // Why: passing any keychainService would change the keystore alias and orphan every already-stored token.
    expect(serviceOf(options as Options)).toBeUndefined()
    expect(generationRecord).toBeNull()
  })

  it('recovers a stale entry by clearing it and retrying the same service, without rotating', async () => {
    secureStoreMock.setItemAsync.mockRejectedValueOnce(ENCRYPT_REJECTION)

    await writeHostTokenToKeychain(TOKEN_KEY, 'token')

    expect(secureStoreMock.deleteItemAsync).toHaveBeenCalledTimes(1)
    expect(secureStoreMock.setItemAsync).toHaveBeenCalledTimes(2)
    expect(serviceOf(secureStoreMock.setItemAsync.mock.calls[1]![2] as Options)).toBeUndefined()
    // Why: a recoverable stale entry must not retire the default service for every other host.
    expect(generationRecord).toBeNull()
  })

  it('rotates to a fresh keystore alias when the shared default alias is unusable (#6600)', async () => {
    // Why: models a wedged AndroidKeyStore alias — every write under key_v1 fails, a new alias works.
    secureStoreMock.setItemAsync.mockImplementation(
      async (_k: string, _v: string, options: Options) => {
        if (serviceOf(options) === undefined) {
          throw ENCRYPT_REJECTION
        }
      }
    )

    await writeHostTokenToKeychain(TOKEN_KEY, 'token')

    const rotated = secureStoreMock.setItemAsync.mock.calls.at(-1)!
    expect(serviceOf(rotated[2] as Options)).toBe('orca.host-tokens.v1')
    expect(rotated[1]).toBe('token')
    expect(generationRecord).toBe('1')
  })

  it('keeps the working service when a rotated write also fails, and surfaces the original error', async () => {
    secureStoreMock.setItemAsync.mockRejectedValue(ENCRYPT_REJECTION)

    await expect(writeHostTokenToKeychain(TOKEN_KEY, 'token')).rejects.toBe(ENCRYPT_REJECTION)
    // Why: retiring a service on a rotation that didn't help would strand readable tokens for nothing.
    expect(generationRecord).toBeNull()
  })

  it('reads through the rotated service once a rotation has been committed', async () => {
    generationRecord = '1'
    secureStoreMock.getItemAsync.mockImplementation(async (_k: string, options: Options) =>
      serviceOf(options) === 'orca.host-tokens.v1' ? 'rotated-token' : null
    )

    await expect(readHostTokenFromKeychain(TOKEN_KEY)).resolves.toBe('rotated-token')
  })

  it('falls back to a retired service so rotation does not orphan a still-readable token', async () => {
    generationRecord = '2'
    secureStoreMock.getItemAsync.mockImplementation(async (_k: string, options: Options) =>
      serviceOf(options) === undefined ? 'legacy-token' : null
    )

    await expect(readHostTokenFromKeychain(TOKEN_KEY)).resolves.toBe('legacy-token')
    // Why: probes must walk v2 -> v1 -> default rather than stopping at the current generation.
    expect(secureStoreMock.getItemAsync).toHaveBeenCalledTimes(3)
  })

  it('keeps reading older services when the current alias throws instead of missing', async () => {
    generationRecord = '1'
    secureStoreMock.getItemAsync.mockImplementation(async (_k: string, options: Options) => {
      if (serviceOf(options) === 'orca.host-tokens.v1') {
        throw new Error('Could not decrypt the value')
      }
      return 'legacy-token'
    })

    await expect(readHostTokenFromKeychain(TOKEN_KEY)).resolves.toBe('legacy-token')
  })

  it('deletes the token under every generation so rotation cannot strand a live credential', async () => {
    generationRecord = '2'

    await deleteHostTokenFromKeychain(TOKEN_KEY)

    const services = secureStoreMock.deleteItemAsync.mock.calls.map((call) =>
      serviceOf(call[1] as Options)
    )
    expect(services).toEqual(['orca.host-tokens.v2', 'orca.host-tokens.v1', undefined])
  })

  it('ignores a malformed generation record instead of failing the write', async () => {
    generationRecord = 'not-a-number'

    await writeHostTokenToKeychain(TOKEN_KEY, 'token')

    expect(serviceOf(secureStoreMock.setItemAsync.mock.calls[0]![2] as Options)).toBeUndefined()
  })

  it('stops rotating at the generation cap rather than probing unbounded services', async () => {
    generationRecord = '8'
    secureStoreMock.setItemAsync.mockRejectedValue(ENCRYPT_REJECTION)

    await expect(writeHostTokenToKeychain(TOKEN_KEY, 'token')).rejects.toBe(ENCRYPT_REJECTION)
    // Why: two attempts under the capped service, then stop — no generation 9.
    expect(secureStoreMock.setItemAsync).toHaveBeenCalledTimes(2)
    expect(generationRecord).toBe('8')
  })
})
