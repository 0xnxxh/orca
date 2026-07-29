import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'

// Why: WHEN_UNLOCKED_THIS_DEVICE_ONLY keeps the pairing token off iCloud Keychain and out of backup restores onto another device.
// Reads/writes stay silent (no biometric prompt) because we don't request access control flags.
const BASE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
}

const GENERATION_STORAGE_KEY = 'orca:host-token-keychain-generation'
const SERVICE_PREFIX = 'orca.host-tokens.v'
// Why: every generation adds one read probe per miss; cap so a pathological device can't make loads O(huge).
const MAX_GENERATION = 8

/**
 * Why: expo-secure-store derives ONE Android keystore alias from the keychain service
 * (`<service>:unauthenticated`), shared by every host token. When that alias becomes
 * unusable the platform rejects `setItemAsync` with a null-message GeneralSecurityException
 * ("Could not encrypt ... Caused by: unknown") for every host, and its built-in self-heal only
 * covers KeyPermanentlyInvalidatedException — so pairing can never be saved again (#6600).
 * Rotating the service mints a fresh alias, which is the only recovery reachable from JS:
 * `deleteItemAsync` provably clears SharedPreferences only, never the keystore key.
 */
function serviceForGeneration(generation: number): string | undefined {
  // Why: generation 0 must keep expo's default service so tokens written by earlier builds stay readable.
  return generation <= 0 ? undefined : `${SERVICE_PREFIX}${generation}`
}

function optionsForGeneration(generation: number): SecureStore.SecureStoreOptions {
  const keychainService = serviceForGeneration(generation)
  return keychainService ? { ...BASE_OPTIONS, keychainService } : BASE_OPTIONS
}

let cachedGeneration: number | null = null

function parseGeneration(raw: string | null): number {
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_GENERATION) {
    return 0
  }
  return parsed
}

async function loadGeneration(): Promise<number> {
  if (cachedGeneration !== null) {
    return cachedGeneration
  }
  let raw: string | null = null
  try {
    raw = await AsyncStorage.getItem(GENERATION_STORAGE_KEY)
  } catch {
    // Why: an unreadable generation record must not block pairing; the default service is the safe guess.
  }
  cachedGeneration = parseGeneration(raw)
  return cachedGeneration
}

// Why: reads only walk back from the recorded generation, so a token stored under a generation
// we failed to record would be unreachable on the next launch. Let the failure propagate and
// cache only after the record is durable, so callers can decline to write under it.
async function commitGeneration(generation: number): Promise<void> {
  await AsyncStorage.setItem(GENERATION_STORAGE_KEY, String(generation))
  cachedGeneration = generation
}

export async function readHostTokenFromKeychain(tokenKey: string): Promise<string | null> {
  const generation = await loadGeneration()
  // Why: walk back through retired services so a rotation doesn't orphan tokens whose original alias still works.
  for (let candidate = generation; candidate >= 0; candidate -= 1) {
    try {
      const value = await SecureStore.getItemAsync(tokenKey, optionsForGeneration(candidate))
      if (value) {
        return value
      }
    } catch {
      // Why: this generation's alias is unusable; an older one may still decrypt.
    }
  }
  return null
}

export async function writeHostTokenToKeychain(tokenKey: string, token: string): Promise<void> {
  const generation = await loadGeneration()
  let firstError: unknown
  try {
    await SecureStore.setItemAsync(tokenKey, token, optionsForGeneration(generation))
    return
  } catch (error) {
    firstError = error
  }

  // Why: a SharedPreferences entry left out of sync with the keystore blocks the write; clearing it is enough to recover.
  try {
    await SecureStore.deleteItemAsync(tokenKey, optionsForGeneration(generation))
    await SecureStore.setItemAsync(tokenKey, token, optionsForGeneration(generation))
    return
  } catch {
    // Fall through to rotation: the shared keystore alias itself is unusable.
  }

  const rotated = generation + 1
  if (rotated > MAX_GENERATION) {
    throw firstError
  }
  // Why: record the rotation before storing under it, so the token can never land under a
  // generation reads won't probe. Advancing early is safe because reads walk back through every
  // older service; the worst case is one spent generation and one extra probe per miss.
  try {
    await commitGeneration(rotated)
  } catch {
    throw firstError
  }
  await SecureStore.setItemAsync(tokenKey, token, optionsForGeneration(rotated)).catch(() => {
    throw firstError
  })
}

export async function deleteHostTokenFromKeychain(tokenKey: string): Promise<void> {
  const generation = await loadGeneration()
  let lastError: unknown
  let deleted = false
  // Why: delete across every generation so a rotation can't strand a live token under a retired service.
  for (let candidate = generation; candidate >= 0; candidate -= 1) {
    try {
      await SecureStore.deleteItemAsync(tokenKey, optionsForGeneration(candidate))
      deleted = true
    } catch (error) {
      lastError = error
    }
  }
  if (!deleted && lastError !== undefined) {
    throw lastError
  }
}

/** Test-only: drop the cached keychain generation between cases. */
export function resetHostTokenKeychainForTests(): void {
  cachedGeneration = null
}
