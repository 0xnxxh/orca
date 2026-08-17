import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  appGetPathMock,
  clearPendingCookieImportMock,
  sessionFromPartitionMock,
  setPendingCookieImportMock
} = vi.hoisted(() => ({
  appGetPathMock: vi.fn(),
  clearPendingCookieImportMock: vi.fn(),
  sessionFromPartitionMock: vi.fn(),
  setPendingCookieImportMock: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPath: appGetPathMock },
  dialog: { showOpenDialog: vi.fn() },
  session: { fromPartition: sessionFromPartitionMock }
}))
vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }))
vi.mock('../codex-accounts/fs-utils', async () => {
  const { copyFileSync } = await import('node:fs')
  return {
    copyFileWithWindowsRetry: (sourcePath: string, destinationPath: string) => {
      if (destinationPath.includes('cookie-import-staging')) {
        throw new Error('staging intentionally unavailable')
      }
      copyFileSync(sourcePath, destinationPath)
    }
  }
})
vi.mock('./browser-session-registry', () => ({
  browserSessionRegistry: {
    setPendingCookieImport: setPendingCookieImportMock,
    clearPendingCookieImport: clearPendingCookieImportMock
  }
}))
vi.mock('./browser-cookie-clear-store', () => ({
  openCookieClearStore: (targetSession: TestSession) => ({
    get: (filter: object) => targetSession.cookies.get(filter),
    remove: (url: string, name: string) => targetSession.cookies.remove(url, name),
    snapshotClearIdentities: async (items: { cookie: Record<string, unknown>; url: string }[]) =>
      items.map(({ cookie, url }) => ({ url, ...cookie })),
    restoreClearIdentities: (identities: Record<string, unknown>[]) =>
      targetSession.restore(identities),
    writeCookieIdentity: (identity: Record<string, unknown>) => targetSession.write(identity),
    dispose: () => undefined
  })
}))

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { importCookiesFromBrowser, importCookiesFromFile } from './browser-cookie-import'
import { createChromiumCookieTestDatabase } from './browser-cookie-import-test-database'

type JarCookie = {
  domain: string
  name: string
  value: string
  path: string
  secure: boolean
  sameSite: 'unspecified'
}

type TestSession = {
  cookies: {
    get: (filter: object) => Promise<JarCookie[]>
    remove: (url: string, name: string) => Promise<void>
    set: (details: Record<string, unknown>) => Promise<void>
    flushStore: () => Promise<void>
  }
  clearData: () => Promise<void>
  getStoragePath: () => string
  restore: (identities: Record<string, unknown>[]) => Promise<void>
  write: (identity: Record<string, unknown>) => Promise<void>
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function jarCookie(name: string, value: string): JarCookie {
  return {
    domain: '.example.com',
    name,
    value,
    path: '/',
    secure: true,
    sameSite: 'unspecified'
  }
}

function replaceCoordinate(jar: JarCookie[], identity: Record<string, unknown>): void {
  const index = jar.findIndex((cookie) => cookie.name === identity.name)
  const next = jarCookie(identity.name as string, identity.value as string)
  if (index === -1) {
    jar.push(next)
  } else {
    jar[index] = next
  }
}

function makeSession(
  storagePath: string,
  jar: JarCookie[],
  write: (identity: Record<string, unknown>) => Promise<void>
): TestSession {
  return {
    cookies: {
      get: async () => [...jar],
      remove: async (_url, name) => {
        for (let index = jar.length - 1; index >= 0; index -= 1) {
          if (jar[index]?.name === name) {
            jar.splice(index, 1)
          }
        }
      },
      set: async () => undefined,
      flushStore: async () => undefined
    },
    clearData: async () => {
      jar.splice(0)
    },
    getStoragePath: () => storagePath,
    restore: async (identities) => {
      for (const identity of identities) {
        replaceCoordinate(jar, identity)
      }
    },
    write
  }
}

function chromeBrowser(cookiesPath: string) {
  return {
    family: 'chrome' as const,
    label: 'Google Chrome',
    cookiesPath,
    keychainService: 'Chrome Safe Storage',
    keychainAccount: 'Chrome',
    profiles: [{ name: 'Default', directory: 'Default' }],
    selectedProfile: 'Default'
  }
}

describe('cookie import mutation transactions', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'orca-cookie-import-concurrency-'))
    appGetPathMock.mockReset().mockReturnValue(join(root, 'userData'))
    sessionFromPartitionMock.mockReset()
    setPendingCookieImportMock.mockReset()
    clearPendingCookieImportMock.mockReset()
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('removes a rejected write that reached the populated jar before CDP detached', async () => {
    const jar = [jarCookie('original', 'old')]
    const session = makeSession(join(root, 'target'), jar, async (identity) => {
      replaceCoordinate(jar, identity)
      if (identity.name === 'detach-after-write') {
        throw new Error('debugger detached after dispatch')
      }
    })
    sessionFromPartitionMock.mockReturnValue(session)
    const sourcePath = join(root, 'source.json')
    writeFileSync(
      sourcePath,
      JSON.stringify([
        { domain: '.example.com', name: 'first', value: 'new', secure: true },
        { domain: '.example.com', name: 'detach-after-write', value: 'leak', secure: true }
      ])
    )

    const result = await importCookiesFromFile(sourcePath, 'persist:test')

    expect(result.ok).toBe(false)
    expect(jar).toEqual([jarCookie('original', 'old')])
  })

  it('prevents a stale validated-import rollback from deleting a successful concurrent import', async () => {
    const jar = [jarCookie('original', 'old')]
    const failureReached = deferred()
    const releaseFailure = deferred()
    const secondTargetReady = deferred()
    const session = makeSession(join(root, 'target'), jar, async (identity) => {
      if (identity.name === 'reject-after-first') {
        failureReached.resolve()
        await releaseFailure.promise
        throw new Error('rejected')
      }
      replaceCoordinate(jar, identity)
    })
    let targetCalls = 0
    sessionFromPartitionMock.mockImplementation(() => {
      targetCalls += 1
      if (targetCalls === 2) {
        secondTargetReady.resolve()
      }
      return session
    })
    const firstPath = join(root, 'first.json')
    const secondPath = join(root, 'second.json')
    writeFileSync(
      firstPath,
      JSON.stringify([
        { domain: '.example.com', name: 'session', value: 'first', secure: true },
        { domain: '.example.com', name: 'reject-after-first', value: 'x', secure: true }
      ])
    )
    writeFileSync(
      secondPath,
      JSON.stringify([{ domain: '.example.com', name: 'session', value: 'second', secure: true }])
    )

    const firstImport = importCookiesFromFile(firstPath, 'persist:test')
    await failureReached.promise
    const secondImport = importCookiesFromFile(secondPath, 'persist:test')
    await secondTargetReady.promise
    await new Promise<void>((resolve) => setImmediate(resolve))
    releaseFailure.resolve()
    const [firstResult, secondResult] = await Promise.all([firstImport, secondImport])

    expect(firstResult.ok).toBe(false)
    expect(secondResult.ok).toBe(true)
    expect(jar).toEqual([jarCookie('session', 'second')])
  })

  it('keeps native clear and writes atomic without relying on staged replay', async () => {
    const targetPath = join(root, 'target')
    const targetCookiesPath = join(targetPath, 'Network', 'Cookies')
    mkdirSync(dirname(targetCookiesPath), { recursive: true })
    createChromiumCookieTestDatabase(targetCookiesPath, []).close()
    const firstSource = join(root, 'first-source', 'Cookies')
    const secondSource = join(root, 'second-source', 'Cookies')
    createChromiumCookieTestDatabase(firstSource, [
      { domain: '.example.com', name: 'from-first', value: 'first' }
    ]).close()
    createChromiumCookieTestDatabase(secondSource, [
      { domain: '.example.com', name: 'from-second', value: 'second' }
    ]).close()
    const jar = [jarCookie('original', 'old')]
    const firstWriteReached = deferred()
    const releaseFirstWrite = deferred()
    const session = makeSession(targetPath, jar, async (identity) => {
      if (identity.name === 'from-first') {
        firstWriteReached.resolve()
        await releaseFirstWrite.promise
      }
      replaceCoordinate(jar, identity)
    })
    sessionFromPartitionMock.mockReturnValue(session)
    const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')

    try {
      const firstImport = importCookiesFromBrowser(chromeBrowser(firstSource), 'persist:test')
      await firstWriteReached.promise
      const secondImport = importCookiesFromBrowser(chromeBrowser(secondSource), 'persist:test')
      await new Promise<void>((resolve) => setImmediate(resolve))
      releaseFirstWrite.resolve()
      const [firstResult, secondResult] = await Promise.all([firstImport, secondImport])

      expect(firstResult.ok).toBe(true)
      expect(secondResult.ok).toBe(true)
      expect(jar).toEqual([jarCookie('from-second', 'second')])
      expect(setPendingCookieImportMock).not.toHaveBeenCalled()
    } finally {
      platformSpy.mockRestore()
    }
  })
})
