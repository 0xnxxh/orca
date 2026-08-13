import { BrowserWindow, webContents, type Cookie, type Session } from 'electron'
import { acquireElectronDebugger } from './electron-debugger-lease'
import { normalizeCookieDomain } from './browser-cookie-import-policy'
import type {
  CookieClearIdentity,
  CookieClearPartitionKey,
  CookieClearStore
} from './browser-cookie-import-clear'

type CdpCookiePartitionKey = {
  topLevelSite?: string
  hasCrossSiteAncestor?: boolean
}

type CdpCookie = {
  name: string
  value: string
  domain?: string
  path?: string
  secure?: boolean
  httpOnly?: boolean
  session?: boolean
  expires?: number
  sameSite?: string
  partitionKey?: CdpCookiePartitionKey
}

type CookieClearDebugger = {
  sendCommand: (method: string, params?: Record<string, unknown>) => Promise<unknown>
}

type CookieClearSession = {
  debugger: CookieClearDebugger
  dispose: () => void
}

function findPartitionWebContents(targetSession: Session) {
  return webContents
    .getAllWebContents()
    .find((contents) => !contents.isDestroyed() && contents.session === targetSession)
}

function cdpSameSite(sameSite: Cookie['sameSite']): 'Strict' | 'Lax' | 'None' {
  if (sameSite === 'strict') {
    return 'Strict'
  }
  if (sameSite === 'no_restriction') {
    return 'None'
  }
  return 'Lax'
}

function electronSameSite(sameSite: string | undefined): Cookie['sameSite'] {
  if (sameSite === 'Strict') {
    return 'strict'
  }
  if (sameSite === 'None') {
    return 'no_restriction'
  }
  return sameSite === 'Lax' ? 'lax' : 'unspecified'
}

function partitionKeyFromCdp(
  partitionKey: CdpCookiePartitionKey | undefined
): CookieClearPartitionKey | undefined {
  const topLevelSite = partitionKey?.topLevelSite
  if (!topLevelSite) {
    return undefined
  }
  return {
    topLevelSite,
    hasCrossSiteAncestor: partitionKey.hasCrossSiteAncestor === true
  }
}

function sameCookieScope(cookie: Cookie, cdpCookie: CdpCookie): boolean {
  const cookieDomain = cookie.domain ? normalizeCookieDomain(cookie.domain) : null
  const cdpDomain = cdpCookie.domain ? normalizeCookieDomain(cdpCookie.domain) : null
  return (
    cookie.name === cdpCookie.name &&
    cookieDomain !== null &&
    cookieDomain === cdpDomain &&
    (cookie.path || '/') === (cdpCookie.path || '/')
  )
}

function identityFromCdpCookie(
  url: string,
  cookie: Cookie,
  cdpCookie: CdpCookie
): CookieClearIdentity {
  const partitionKey = partitionKeyFromCdp(cdpCookie.partitionKey)
  return {
    url,
    name: cdpCookie.name,
    value: cdpCookie.value,
    domain: cdpCookie.domain,
    hostOnly: cookie.hostOnly,
    path: cdpCookie.path,
    secure: cdpCookie.secure,
    httpOnly: cdpCookie.httpOnly,
    sameSite: electronSameSite(cdpCookie.sameSite),
    ...(cdpCookie.session === true || cdpCookie.expires == null
      ? {}
      : { expirationDate: cdpCookie.expires }),
    ...(partitionKey ? { partitionKey } : {})
  }
}

async function attachCookieClearSession(targetSession: Session): Promise<CookieClearSession> {
  const existing = findPartitionWebContents(targetSession)
  const window = existing
    ? null
    : new BrowserWindow({
        show: false,
        webPreferences: {
          session: targetSession,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false
        }
      })
  try {
    if (window) {
      await window.loadURL('data:text/html,<!doctype html><title>cookie-clear</title>')
    }
    const contents = existing ?? window?.webContents
    if (!contents || contents.isDestroyed()) {
      throw new Error('Could not attach to the cookie session for an atomic clear')
    }
    const lease = acquireElectronDebugger(contents)
    try {
      await contents.debugger.sendCommand('Network.enable')
    } catch (error) {
      lease.release()
      throw error
    }
    return {
      debugger: contents.debugger,
      dispose: () => {
        lease.release()
        window?.destroy()
      }
    }
  } catch (error) {
    window?.destroy()
    throw error
  }
}

export function cookieClearIdentitiesFromCdp(
  cookies: readonly { cookie: Cookie; url: string }[],
  cdpCookies: readonly CdpCookie[]
): CookieClearIdentity[] {
  const identities: CookieClearIdentity[] = []
  const seen = new Set<string>()
  for (const item of cookies) {
    const matches = cdpCookies.filter((cdpCookie) => sameCookieScope(item.cookie, cdpCookie))
    if (matches.length === 0) {
      throw new Error('Could not snapshot cookie identity for an atomic clear')
    }
    for (const match of matches) {
      const key = JSON.stringify([
        item.url,
        match.name,
        match.domain,
        match.path,
        partitionKeyFromCdp(match.partitionKey) ?? null
      ])
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      identities.push(identityFromCdpCookie(item.url, item.cookie, match))
    }
  }
  return identities
}

export function cdpRestoreParamsFromIdentity(
  identity: CookieClearIdentity
): Record<string, unknown> {
  return {
    url: identity.url,
    name: identity.name,
    value: identity.value,
    ...(identity.hostOnly ? {} : { domain: identity.domain }),
    ...(identity.path ? { path: identity.path } : {}),
    secure: identity.secure,
    httpOnly: identity.httpOnly,
    sameSite: cdpSameSite(identity.sameSite),
    ...(identity.expirationDate ? { expires: identity.expirationDate } : {}),
    ...(identity.partitionKey ? { partitionKey: identity.partitionKey } : {})
  }
}

function cdpCookiesFromCommand(value: unknown): CdpCookie[] {
  if (typeof value !== 'object' || value === null || !('cookies' in value)) {
    return []
  }
  const cookies = value.cookies
  return Array.isArray(cookies) ? cookies : []
}

function cdpSetCookieSucceeded(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || !('success' in value)) {
    return true
  }
  return value.success !== false
}

async function snapshotClearIdentitiesFromCdp(
  cookieDebugger: CookieClearDebugger,
  cookies: readonly { cookie: Cookie; url: string }[]
): Promise<CookieClearIdentity[]> {
  const result = await cookieDebugger.sendCommand('Network.getAllCookies')
  return cookieClearIdentitiesFromCdp(cookies, cdpCookiesFromCommand(result))
}

async function restoreClearIdentitiesWithCdp(
  cookieDebugger: CookieClearDebugger,
  identities: readonly CookieClearIdentity[]
): Promise<void> {
  for (const identity of identities) {
    const result = await cookieDebugger.sendCommand(
      'Network.setCookie',
      cdpRestoreParamsFromIdentity(identity)
    )
    if (!cdpSetCookieSucceeded(result)) {
      throw new Error(`Could not restore cookie ${identity.name}`)
    }
  }
}

export function openCookieClearStore(
  targetSession: Session
): CookieClearStore & { dispose: () => void } {
  let attached: CookieClearSession | null = null
  const attach = async () => {
    attached ??= await attachCookieClearSession(targetSession)
    return attached
  }
  return {
    get: (filter) => targetSession.cookies.get(filter),
    remove: (url, name) => targetSession.cookies.remove(url, name),
    snapshotClearIdentities: async (cookies) =>
      snapshotClearIdentitiesFromCdp((await attach()).debugger, cookies),
    restoreClearIdentities: async (identities) =>
      restoreClearIdentitiesWithCdp((await attach()).debugger, identities),
    dispose: () => {
      attached?.dispose()
      attached = null
    }
  }
}
