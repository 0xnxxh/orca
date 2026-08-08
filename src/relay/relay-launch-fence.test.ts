import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  relayGcClaimOwnerFileName,
  relayInstallLockOwnerFileName
} from '../shared/relay-launch-fence-owner'
import { releaseRelayLaunchFence } from './relay-launch-fence'

const cleanupDirs: string[] = []
const installOwner = 'install-owner-token-00000001'
const gcOwner = 'gc-owner-token-00000000000001'

afterEach(() => {
  for (const directory of cleanupDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
    rmSync(`${directory}.gc-claim`, { recursive: true, force: true })
  }
})

describe('relay launch fence', () => {
  it('releases the exact tokenized install lock after liveness is proven', () => {
    const directory = relayDir()
    const lockPath = join(directory, '.install-lock')
    mkdirSync(lockPath)
    writeFileSync(join(lockPath, '.owner'), '')
    writeFileSync(join(lockPath, relayInstallLockOwnerFileName(installOwner)), installOwner)

    releaseRelayLaunchFence(directory, {
      releaseInstallLock: true,
      installLockOwnerToken: installOwner
    })

    expect(existsSync(lockPath)).toBe(false)
  })

  it('conditionally releases its exact GC claim while retaining the legacy marker shape', () => {
    const directory = relayDir()
    const claimPath = `${directory}.gc-claim`
    mkdirSync(claimPath)
    writeFileSync(join(claimPath, '.gc-owner'), gcOwner)
    writeFileSync(join(claimPath, relayGcClaimOwnerFileName(gcOwner)), gcOwner)

    releaseRelayLaunchFence(directory, { gcClaimOwnerToken: gcOwner })

    expect(existsSync(claimPath)).toBe(false)
  })

  it('preserves successor install and GC generations at the replacement boundary', () => {
    const directory = relayDir()
    const lockPath = join(directory, '.install-lock')
    const claimPath = `${directory}.gc-claim`
    const successorInstall = 'install-owner-token-00000002'
    const successorGc = 'gc-owner-token-00000000000002'
    mkdirSync(lockPath)
    writeFileSync(join(lockPath, relayInstallLockOwnerFileName(successorInstall)), successorInstall)
    mkdirSync(claimPath)
    writeFileSync(join(claimPath, '.gc-owner'), successorGc)
    writeFileSync(join(claimPath, relayGcClaimOwnerFileName(successorGc)), successorGc)

    expect(() =>
      releaseRelayLaunchFence(directory, {
        releaseInstallLock: true,
        installLockOwnerToken: installOwner
      })
    ).toThrow('ownership changed')
    expect(() => releaseRelayLaunchFence(directory, { gcClaimOwnerToken: gcOwner })).toThrow(
      'ownership changed'
    )
    expect(
      readFileSync(join(lockPath, relayInstallLockOwnerFileName(successorInstall)), 'utf8')
    ).toBe(successorInstall)
    expect(readFileSync(join(claimPath, '.gc-owner'), 'utf8')).toBe(successorGc)
  })

  it('fails closed when an install release omits its acquisition identity', () => {
    const directory = relayDir()
    const lockPath = join(directory, '.install-lock')
    mkdirSync(lockPath)

    expect(() => releaseRelayLaunchFence(directory, { releaseInstallLock: true })).toThrow(
      'identity is missing'
    )
    expect(existsSync(lockPath)).toBe(true)
  })

  it('accepts a fence already released by the detached daemon', () => {
    expect(() =>
      releaseRelayLaunchFence(relayDir(), {
        releaseInstallLock: true,
        installLockOwnerToken: installOwner,
        gcClaimOwnerToken: gcOwner
      })
    ).not.toThrow()
  })
})

function relayDir(): string {
  const directory = mkdtempSync(join(tmpdir(), 'orca-relay-launch-fence-'))
  cleanupDirs.push(directory)
  return directory
}
