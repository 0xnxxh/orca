import { safeStorage } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  hardenExistingSecureFileAsync,
  removeSecureFileAsync,
  writeSecureFileAsync
} from '../../shared/secure-file'

const MINIMAX_COOKIE_FILE = 'minimax-session-cookie.enc'
const COOKIE_ENVELOPE_PREFIX = 'orca-minimax-cookie:v1:'
let cachedMiniMaxCookie: string | null = null
// Why: secure-file orders the fs ops per path but not the cache, whose writes happen after
// an await; the last caller wins the cache so a clear can't be undone by a queued save.
let miniMaxCookieCacheGeneration = 0

type MiniMaxCookieEnvelope = {
  kind: 'encrypted' | 'plaintext'
  payload: Buffer
}

function getOrcaDir(): string {
  return join(homedir(), '.orca')
}

function getMiniMaxCookiePath(): string {
  return join(getOrcaDir(), MINIMAX_COOKIE_FILE)
}

function encodeCookieEnvelope(kind: MiniMaxCookieEnvelope['kind'], payload: Buffer): string {
  return `${COOKIE_ENVELOPE_PREFIX}${kind}:${payload.toString('base64')}`
}

function decodeCookieEnvelope(raw: Buffer): MiniMaxCookieEnvelope | null {
  const text = raw.toString('utf8')
  if (!text.startsWith(COOKIE_ENVELOPE_PREFIX)) {
    return null
  }
  const rest = text.slice(COOKIE_ENVELOPE_PREFIX.length)
  const separator = rest.indexOf(':')
  if (separator < 0) {
    throw new Error('MiniMax session cookie could not be decrypted')
  }
  const kind = rest.slice(0, separator)
  if (kind !== 'encrypted' && kind !== 'plaintext') {
    throw new Error('MiniMax session cookie could not be decrypted')
  }
  return {
    kind,
    payload: Buffer.from(rest.slice(separator + 1), 'base64')
  }
}

// Why: migrates cookies saved before the envelope format existed. Older files
// hold raw bytes (safeStorage-encrypted or plaintext), so we sniff the content
// to tell the two apart rather than removing this as seemingly dead code.
function looksLikeCookieHeader(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) {
    return false
  }
  for (let index = 0; index < trimmed.length; index += 1) {
    const code = trimmed.charCodeAt(index)
    if (code < 32 || code === 127) {
      return false
    }
  }
  return (
    /^Cookie:\s*\S+/i.test(trimmed) ||
    /(?:^|;\s*)[A-Za-z0-9_.-]+\s*=/.test(trimmed) ||
    /(?:^|[;\s])[A-Za-z0-9_.-]+\s*:\s*["'][^"']+["']/.test(trimmed)
  )
}

function readEnvelope(envelope: MiniMaxCookieEnvelope): string {
  if (envelope.kind === 'plaintext') {
    return envelope.payload.toString('utf8')
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('MiniMax session cookie could not be decrypted')
  }
  return safeStorage.decryptString(envelope.payload)
}

function readLegacyCookie(raw: Buffer): string {
  if (safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(raw)
    } catch {
      const plaintext = raw.toString('utf8')
      if (looksLikeCookieHeader(plaintext)) {
        return plaintext
      }
      throw new Error('MiniMax session cookie could not be decrypted')
    }
  }
  const plaintext = raw.toString('utf8')
  if (looksLikeCookieHeader(plaintext)) {
    return plaintext
  }
  throw new Error('MiniMax session cookie could not be decrypted')
}

/**
 * Sync twin kept for RateLimitService.getState(), which is a synchronous snapshot
 * builder. Hardening is a write-time invariant, so the status probe no longer pays
 * the stat/chmod pair — one access() instead of ~7 syscalls under a stalled HOME.
 */
export function hasMiniMaxSessionCookie(): boolean {
  return existsSync(getMiniMaxCookiePath())
}

export async function hasMiniMaxSessionCookieAsync(): Promise<boolean> {
  try {
    await access(getMiniMaxCookiePath())
    return true
  } catch {
    return false
  }
}

function encodeCookieForStorage(cookie: string): string {
  const trimmed = cookie.trim()
  if (!trimmed) {
    throw new Error('MiniMax session cookie is required')
  }
  if (safeStorage.isEncryptionAvailable()) {
    return encodeCookieEnvelope('encrypted', safeStorage.encryptString(trimmed))
  }
  console.warn('[minimax] safeStorage encryption unavailable — storing MiniMax cookie in plaintext')
  return encodeCookieEnvelope('plaintext', Buffer.from(trimmed, 'utf8'))
}

export async function saveMiniMaxSessionCookieAsync(cookie: string): Promise<void> {
  const encoded = encodeCookieForStorage(cookie)
  const generation = ++miniMaxCookieCacheGeneration
  await writeSecureFileAsync(getMiniMaxCookiePath(), encoded)
  if (generation === miniMaxCookieCacheGeneration) {
    cachedMiniMaxCookie = cookie.trim()
  }
}

function decodeStoredCookie(raw: Buffer): string {
  try {
    const envelope = decodeCookieEnvelope(raw)
    return envelope ? readEnvelope(envelope) : readLegacyCookie(raw)
  } catch (error) {
    console.error('[minimax] failed to decode/decrypt session cookie', error)
    throw new Error('MiniMax session cookie could not be decrypted')
  }
}

// Why: re-hardening is defence in depth, not a correctness gate — fire it off-thread so a stalled mount can't park the read.
function scheduleCookieRehardening(keyPath: string): void {
  void hardenExistingSecureFileAsync(keyPath).catch((error: unknown) => {
    console.warn('[minimax] Failed to harden MiniMax cookie file while reading', error)
  })
}

/** Sync twin kept for the MiniMax config resolver, which RateLimitService calls synchronously. */
export function readMiniMaxSessionCookie(): string | null {
  if (cachedMiniMaxCookie !== null) {
    return cachedMiniMaxCookie
  }
  const keyPath = getMiniMaxCookiePath()
  let raw: Buffer
  try {
    // Why: a single read replaces existsSync+readFileSync; ENOENT already means "not configured".
    raw = readFileSync(keyPath)
  } catch (error) {
    if (isMissingFileError(error)) {
      return null
    }
    throw new Error('MiniMax session cookie could not be decrypted')
  }
  scheduleCookieRehardening(keyPath)
  cachedMiniMaxCookie = decodeStoredCookie(raw)
  return cachedMiniMaxCookie
}

export async function readMiniMaxSessionCookieAsync(): Promise<string | null> {
  if (cachedMiniMaxCookie !== null) {
    return cachedMiniMaxCookie
  }
  const keyPath = getMiniMaxCookiePath()
  let raw: Buffer
  try {
    raw = await readFile(keyPath)
  } catch (error) {
    if (isMissingFileError(error)) {
      return null
    }
    throw new Error('MiniMax session cookie could not be decrypted')
  }
  scheduleCookieRehardening(keyPath)
  cachedMiniMaxCookie = decodeStoredCookie(raw)
  return cachedMiniMaxCookie
}

function isMissingFileError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

export async function clearMiniMaxSessionCookieAsync(): Promise<void> {
  const generation = ++miniMaxCookieCacheGeneration
  cachedMiniMaxCookie = null
  // Why: a bare rm would unlink before an in-flight save's rename republished the file.
  await removeSecureFileAsync(getMiniMaxCookiePath())
  // Why: a sync read can repopulate the cache from disk while we wait for our turn.
  if (generation === miniMaxCookieCacheGeneration) {
    cachedMiniMaxCookie = null
  }
}
