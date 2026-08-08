import { existsSync, lstatSync, readFileSync, rmSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import {
  isRelayLaunchFenceOwnerToken,
  relayGcClaimOwnerFileName,
  relayInstallLockOwnerFileName
} from '../shared/relay-launch-fence-owner'

const INSTALL_LOCK_NAME = '.install-lock'
const GC_CLAIM_SUFFIX = '.gc-claim'

export type RelayLaunchFence = Readonly<{
  releaseInstallLock?: true
  installLockOwnerToken?: string
  gcClaimOwnerToken?: string
}>

export { isRelayLaunchFenceOwnerToken }

export function releaseRelayLaunchFence(relayDir: string, fence?: RelayLaunchFence): void {
  if (!fence) {
    return
  }
  if (fence.gcClaimOwnerToken) {
    releaseExactFenceDirectory(
      `${relayDir}${GC_CLAIM_SUFFIX}`,
      fence.gcClaimOwnerToken,
      relayGcClaimOwnerFileName(fence.gcClaimOwnerToken)
    )
  }
  if (fence.releaseInstallLock) {
    if (!fence.installLockOwnerToken) {
      throw new Error('Relay launch install lock owner identity is missing')
    }
    releaseExactFenceDirectory(
      join(relayDir, INSTALL_LOCK_NAME),
      fence.installLockOwnerToken,
      relayInstallLockOwnerFileName(fence.installLockOwnerToken)
    )
  }
}

function releaseExactFenceDirectory(
  fencePath: string,
  ownerToken: string,
  ownerFileName: string
): void {
  if (!existsSync(fencePath)) {
    return
  }
  const fenceMetadata = lstatSync(fencePath)
  if (!fenceMetadata.isDirectory() || fenceMetadata.isSymbolicLink()) {
    throw new Error('Relay launch fence is not an owned directory')
  }
  const ownerPath = join(fencePath, ownerFileName)
  let metadata
  try {
    metadata = lstatSync(ownerPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('Relay launch fence ownership changed before release')
    }
    throw error
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 4 * 1024) {
    throw new Error('Relay launch fence owner identity is invalid')
  }
  if (readFileSync(ownerPath, 'utf8') !== ownerToken) {
    throw new Error('Relay launch fence ownership changed before release')
  }
  try {
    unlinkSync(ownerPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('Relay launch fence ownership changed before release')
    }
    throw error
  }
  rmSync(fencePath, { recursive: true, force: false })
  if (existsSync(fencePath)) {
    throw new Error(`Relay launch fence remains at ${fencePath}`)
  }
}
