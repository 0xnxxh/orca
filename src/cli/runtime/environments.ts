import {
  addEnvironmentFromPairingCode as addEnvironmentFromPairingCodeInStore,
  getEnvironmentRuntimeCompat as getEnvironmentRuntimeCompatInStore,
  getEnvironmentStorePath,
  listEnvironments,
  markEnvironmentUsed as markEnvironmentUsedInStore,
  recordEnvironmentRuntimeCompat as recordEnvironmentRuntimeCompatInStore,
  removeEnvironment as removeEnvironmentFromStore,
  resolveEnvironment as resolveEnvironmentFromStore,
  resolveEnvironmentPairingOffer as resolveEnvironmentPairingOfferFromStore,
  RuntimeEnvironmentStoreError,
  type RuntimeEnvironmentStoreErrorCode
} from '../../shared/runtime-environment-store'
import type {
  KnownRuntimeEnvironment,
  PublicKnownRuntimeEnvironment,
  RuntimeEnvironmentCompat
} from '../../shared/runtime-environments'
import type { PairingOffer } from '../../shared/pairing'
import { RuntimeClientError } from './types'

export type EnvironmentAddResult = {
  environment: PublicKnownRuntimeEnvironment
}

export type EnvironmentRemoveResult = {
  removed: PublicKnownRuntimeEnvironment
}

export { getEnvironmentStorePath, listEnvironments }

export function addEnvironmentFromPairingCode(
  userDataPath: string,
  args: { name: string; pairingCode: string; now?: number }
): KnownRuntimeEnvironment {
  return translateStoreError(() => addEnvironmentFromPairingCodeInStore(userDataPath, args))
}

export function removeEnvironment(userDataPath: string, selector: string): KnownRuntimeEnvironment {
  return translateStoreError(() => removeEnvironmentFromStore(userDataPath, selector))
}

export function resolveEnvironment(
  userDataPath: string,
  selector: string
): KnownRuntimeEnvironment {
  return translateStoreError(() => resolveEnvironmentFromStore(userDataPath, selector))
}

export function resolveEnvironmentPairingOffer(
  userDataPath: string,
  selector: string
): PairingOffer {
  return translateStoreError(() => resolveEnvironmentPairingOfferFromStore(userDataPath, selector))
}

export function markEnvironmentUsed(
  userDataPath: string,
  selector: string,
  args: { runtimeId?: string | null; now?: number } = {}
): void {
  translateStoreError(() => markEnvironmentUsedInStore(userDataPath, selector, args))
}

export function getEnvironmentRuntimeCompat(
  userDataPath: string,
  selector: string
): RuntimeEnvironmentCompat | null {
  return translateStoreError(() => getEnvironmentRuntimeCompatInStore(userDataPath, selector))
}

export function recordEnvironmentRuntimeCompat(
  userDataPath: string,
  selector: string,
  compat: RuntimeEnvironmentCompat
): void {
  translateStoreError(() => recordEnvironmentRuntimeCompatInStore(userDataPath, selector, compat))
}

function translateStoreError<TResult>(fn: () => TResult): TResult {
  try {
    return fn()
  } catch (error) {
    if (error instanceof RuntimeEnvironmentStoreError) {
      throw new RuntimeClientError(toRuntimeClientErrorCode(error.code), error.message)
    }
    throw error
  }
}

function toRuntimeClientErrorCode(
  code: RuntimeEnvironmentStoreErrorCode
): 'invalid_argument' | 'runtime_error' {
  return code
}
