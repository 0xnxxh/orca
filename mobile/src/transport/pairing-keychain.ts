import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'

// Why: WHEN_UNLOCKED_THIS_DEVICE_ONLY keeps pairing credentials off iCloud Keychain and backup restores.
const BASE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
}

const GENERATION_STORAGE_KEY = 'orca:pairing-keychain-generation'
const SERVICE_PREFIX = 'orca.pairing.v'
// Why: every generation adds one read probe per miss; bound pathological recovery cost.
const MAX_GENERATION = 8

/**
 * Why: expo-secure-store shares one Android keystore alias across every
 * unauthenticated item under a keychain service. The #6600 rejection proves
 * encryption reached expo's null-message GeneralSecurityException branch; a
 * fresh service selects a distinct alias and can recover an alias-local fault.
 */
function serviceForGeneration(generation: number): string | undefined {
  // Why: generation 0 must keep expo's default service so existing credentials stay readable.
  return generation <= 0 ? undefined : `${SERVICE_PREFIX}${generation}`
}

function optionsForGeneration(generation: number): SecureStore.SecureStoreOptions {
  const keychainService = serviceForGeneration(generation)
  return keychainService ? { ...BASE_OPTIONS, keychainService } : BASE_OPTIONS
}

type LoadedGeneration =
  | { generation: number; reliable: true }
  | { generation: 0; reliable: false; error: unknown }

let cachedGeneration: number | null = null
let keychainMutation: Promise<void> = Promise.resolve()

function parseGeneration(raw: string | null): LoadedGeneration {
  if (raw === null) {
    return { generation: 0, reliable: true }
  }
  const parsed = Number(raw)
  if (
    !Number.isInteger(parsed) ||
    parsed < 0 ||
    parsed > MAX_GENERATION ||
    String(parsed) !== raw
  ) {
    return {
      generation: 0,
      reliable: false,
      error: new Error('pairing keychain generation record is invalid')
    }
  }
  return { generation: parsed, reliable: true }
}

async function loadGeneration(): Promise<LoadedGeneration> {
  if (cachedGeneration !== null) {
    return { generation: cachedGeneration, reliable: true }
  }
  try {
    const loaded = parseGeneration(await AsyncStorage.getItem(GENERATION_STORAGE_KEY))
    if (loaded.reliable) {
      cachedGeneration = loaded.generation
    }
    return loaded
  } catch (error) {
    // Why: don't cache or rotate from a guess; a later read may recover the durable pointer.
    return { generation: 0, reliable: false, error }
  }
}

// Why: reads only walk back from the recorded generation, so persist before writing under it.
async function commitGeneration(generation: number): Promise<void> {
  await AsyncStorage.setItem(GENERATION_STORAGE_KEY, String(generation))
  cachedGeneration = generation
}

function enqueueKeychainMutation(operation: () => Promise<void>): Promise<void> {
  const mutation = keychainMutation.then(operation)
  keychainMutation = mutation.catch(() => {})
  return mutation
}

export async function readPairingKeychainItem(key: string): Promise<string | null> {
  await keychainMutation
  const loaded = await loadGeneration()
  const firstCandidate = loaded.reliable ? loaded.generation : MAX_GENERATION
  let firstError: unknown
  for (let candidate = firstCandidate; candidate >= 0; candidate -= 1) {
    try {
      const value = await SecureStore.getItemAsync(key, optionsForGeneration(candidate))
      if (value !== null) {
        return value
      }
    } catch (error) {
      firstError ??= error
    }
  }
  if (firstError !== undefined) {
    throw firstError
  }
  return null
}

async function writePairingKeychainItemImpl(key: string, value: string): Promise<void> {
  const loaded = await loadGeneration()
  if (!loaded.reliable) {
    throw loaded.error
  }
  const generation = loaded.generation
  let firstError: unknown
  try {
    await SecureStore.setItemAsync(key, value, optionsForGeneration(generation))
    return
  } catch (error) {
    firstError = error
  }

  if (!isAndroidEncryptionFailure(firstError)) {
    throw firstError
  }
  const rotated = generation + 1
  if (rotated > MAX_GENERATION) {
    throw firstError
  }
  try {
    await commitGeneration(rotated)
  } catch {
    throw firstError
  }
  await SecureStore.setItemAsync(key, value, optionsForGeneration(rotated)).catch(() => {
    throw firstError
  })
}

function isAndroidEncryptionFailure(error: unknown): boolean {
  if (Platform.OS !== 'android' || !error || typeof error !== 'object') {
    return false
  }
  const message = 'message' in error ? error.message : null
  return typeof message === 'string' && message.includes('Could not encrypt the value for key')
}

export function writePairingKeychainItem(key: string, value: string): Promise<void> {
  return enqueueKeychainMutation(() => writePairingKeychainItemImpl(key, value))
}

async function deletePairingKeychainItemImpl(key: string): Promise<void> {
  const loaded = await loadGeneration()
  const firstCandidate = loaded.reliable ? loaded.generation : MAX_GENERATION
  let firstError: unknown
  for (let candidate = firstCandidate; candidate >= 0; candidate -= 1) {
    try {
      await SecureStore.deleteItemAsync(key, optionsForGeneration(candidate))
    } catch (error) {
      firstError ??= error
    }
  }
  if (firstError !== undefined) {
    throw firstError
  }
}

export function deletePairingKeychainItem(key: string): Promise<void> {
  return enqueueKeychainMutation(() => deletePairingKeychainItemImpl(key))
}

/** Test-only: drop cached generation and mutation state between cases. */
export function resetPairingKeychainForTests(): void {
  cachedGeneration = null
  keychainMutation = Promise.resolve()
}
