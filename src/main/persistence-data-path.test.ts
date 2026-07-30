import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as SecureFile from '../shared/secure-file'
import { E2EE_KEYPAIR_FILENAME, DEVICE_REGISTRY_FILENAME } from './runtime/mobile-pairing-files'

const pathMocks = vi.hoisted(() => ({
  appState: { userData: '' },
  hardenExistingSecureFile: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPath: () => pathMocks.appState.userData },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (plaintext: string) => Buffer.from(plaintext, 'utf8'),
    decryptString: (ciphertext: Buffer) => ciphertext.toString('utf8')
  }
}))

vi.mock('../shared/secure-file', async (importOriginal) => ({
  ...(await importOriginal<typeof SecureFile>()),
  hardenExistingSecureFile: pathMocks.hardenExistingSecureFile
}))

describe('persistence data path state', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'orca-persistence-path-'))
    pathMocks.hardenExistingSecureFile.mockReset()
    vi.resetModules()
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    vi.resetModules()
  })

  it('keeps the fallback data file and userData path in one captured state', async () => {
    const fallbackPath = join(root, 'fallback-user-data')
    const latePath = join(root, 'late-user-data')
    pathMocks.appState.userData = fallbackPath
    const paths = await import('./persistence-data-path')

    expect(paths.getPersistenceDataFilePath()).toBe(join(fallbackPath, 'orca-data.json'))
    pathMocks.appState.userData = latePath
    expect(paths.getCanonicalUserDataPath()).toBe(fallbackPath)
    expect(paths.getPersistenceDataFilePath()).toBe(join(fallbackPath, 'orca-data.json'))

    paths.initDataPath()
    expect(paths.getCanonicalUserDataPath()).toBe(latePath)
    expect(paths.getPersistenceDataFilePath()).toBe(join(latePath, 'orca-data.json'))
  })

  it('shares the initialized state through persistence compatibility re-exports', async () => {
    const canonicalPath = join(root, 'canonical-user-data')
    pathMocks.appState.userData = canonicalPath
    const paths = await import('./persistence-data-path')
    const persistence = await import('./persistence')

    expect(persistence.initDataPath).toBe(paths.initDataPath)
    expect(persistence.getCanonicalUserDataPath).toBe(paths.getCanonicalUserDataPath)
    persistence.initDataPath()
    pathMocks.appState.userData = join(root, 'late-user-data')

    expect(paths.getCanonicalUserDataPath()).toBe(canonicalPath)
    expect(paths.getPersistenceDataFilePath()).toBe(join(canonicalPath, 'orca-data.json'))
  })

  it('migrates and hardens the complete mobile credential pair', async () => {
    const sourcePath = join(root, 'late-user-data')
    const canonicalPath = join(root, 'canonical-user-data')
    mkdirSync(sourcePath, { recursive: true })
    mkdirSync(canonicalPath, { recursive: true })
    const devices = '{"devices":"source"}'
    const keypair = '{"keypair":"source"}'
    writeFileSync(join(sourcePath, DEVICE_REGISTRY_FILENAME), devices)
    writeFileSync(join(sourcePath, E2EE_KEYPAIR_FILENAME), keypair)
    pathMocks.appState.userData = canonicalPath
    const paths = await import('./persistence-data-path')
    paths.initDataPath()

    paths.migrateMobilePairingDataToCanonicalUserDataPath(sourcePath)

    const deviceTarget = join(canonicalPath, DEVICE_REGISTRY_FILENAME)
    const keypairTarget = join(canonicalPath, E2EE_KEYPAIR_FILENAME)
    expect(readFileSync(deviceTarget, 'utf8')).toBe(devices)
    expect(readFileSync(keypairTarget, 'utf8')).toBe(keypair)
    expect(pathMocks.hardenExistingSecureFile.mock.calls).toEqual([[deviceTarget], [keypairTarget]])
  })
})
