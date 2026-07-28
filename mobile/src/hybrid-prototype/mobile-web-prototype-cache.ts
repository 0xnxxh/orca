import AsyncStorage from '@react-native-async-storage/async-storage'
import { Buffer } from 'buffer'
import { sha256 } from '@noble/hashes/sha256'
import {
  verifyMobileWebPrototypePackage,
  type VerifiedMobileWebPrototypePackage
} from './mobile-web-prototype-package'

const CACHE_PREFIX = 'orca:mobile-web-prototype'

function hostCacheId(hostId: string): string {
  return Buffer.from(sha256(new TextEncoder().encode(hostId))).toString('hex')
}

function activeKey(hostId: string): string {
  return `${CACHE_PREFIX}:${hostCacheId(hostId)}:active`
}

function packageKey(hostId: string, buildId: string): string {
  return `${CACHE_PREFIX}:${hostCacheId(hostId)}:package:${buildId}`
}

export async function loadCachedMobileWebPrototypePackage(
  hostId: string
): Promise<VerifiedMobileWebPrototypePackage | null> {
  try {
    const buildId = await AsyncStorage.getItem(activeKey(hostId))
    if (!buildId || !/^[a-f0-9]{64}$/.test(buildId)) {
      return null
    }
    const raw = await AsyncStorage.getItem(packageKey(hostId, buildId))
    if (!raw) {
      return null
    }
    return verifyMobileWebPrototypePackage(JSON.parse(raw) as unknown)
  } catch {
    return null
  }
}

export async function saveMobileWebPrototypePackage(
  hostId: string,
  prototypePackage: VerifiedMobileWebPrototypePackage
): Promise<void> {
  const verified = verifyMobileWebPrototypePackage(prototypePackage)
  if (!verified) {
    throw new Error('Refusing to cache an unverified prototype package.')
  }

  const pointerKey = activeKey(hostId)
  const previousBuildId = await AsyncStorage.getItem(pointerKey)
  await AsyncStorage.setItem(
    packageKey(hostId, verified.manifest.buildId),
    JSON.stringify(verified)
  )
  // Why: publish the active pointer only after the immutable package is durable.
  await AsyncStorage.setItem(pointerKey, verified.manifest.buildId)
  if (
    previousBuildId &&
    previousBuildId !== verified.manifest.buildId &&
    /^[a-f0-9]{64}$/.test(previousBuildId)
  ) {
    await AsyncStorage.removeItem(packageKey(hostId, previousBuildId)).catch(() => {})
  }
}
