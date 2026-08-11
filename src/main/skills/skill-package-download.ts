import { createHash, timingSafeEqual } from 'node:crypto'
import { mkdir, mkdtemp, open, rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  SKILL_PACKAGE_CONTENT_TYPE,
  SKILL_PACKAGE_MAX_COMPRESSED_BYTES
} from '../../shared/skill-package-manifest'

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const MAX_REDIRECTS = 3

export type SkillPackageDownloadResult = {
  archivePath: string
  archiveSha256: string
  compressedBytes: number
  cleanup(): Promise<void>
}

type SkillPackageDownloadInput = {
  url: string
  expiresAt: string
  expectedArchiveSha256: string
  expectedCompressedBytes: number
  temporaryRoot: string
  allowedOrigins: readonly string[]
  requireHttps: boolean
  signal?: AbortSignal
  fetcher?: typeof fetch
  now?: () => number
}

function validateIdentity(input: SkillPackageDownloadInput): void {
  if (!/^[a-f0-9]{64}$/.test(input.expectedArchiveSha256)) {
    throw new Error('skill-download-archive-identity-invalid')
  }
  if (
    !Number.isInteger(input.expectedCompressedBytes) ||
    input.expectedCompressedBytes < 1 ||
    input.expectedCompressedBytes > SKILL_PACKAGE_MAX_COMPRESSED_BYTES
  ) {
    throw new Error('skill-download-size-invalid')
  }
}

function validateUrl(
  value: string,
  allowedOrigins: ReadonlySet<string>,
  requireHttps: boolean
): URL {
  const url = new URL(value)
  if (url.username || url.password || (requireHttps && url.protocol !== 'https:')) {
    throw new Error('skill-download-url-rejected')
  }
  if (!allowedOrigins.has(url.origin)) {
    throw new Error('skill-download-origin-rejected')
  }
  return url
}

function throwIfUnavailable(input: SkillPackageDownloadInput, expiresAt: number): void {
  if (input.signal?.aborted) {
    throw new Error('skill-download-cancelled')
  }
  if (input.now!() >= expiresAt) {
    throw new Error('skill-download-grant-expired')
  }
}

async function fetchWithoutCredentialRedirect(
  input: SkillPackageDownloadInput,
  allowedOrigins: ReadonlySet<string>,
  expiresAt: number
): Promise<Response> {
  let url = validateUrl(input.url, allowedOrigins, input.requireHttps)
  for (let redirectCount = 0; ; redirectCount += 1) {
    throwIfUnavailable(input, expiresAt)
    let response: Response
    try {
      response = await input.fetcher!(url, {
        method: 'GET',
        redirect: 'manual',
        signal: input.signal
      })
    } catch {
      if (input.signal?.aborted) {
        throw new Error('skill-download-cancelled')
      }
      throw new Error('skill-download-transport-failed')
    }
    if (!REDIRECT_STATUSES.has(response.status)) {
      return response
    }
    if (redirectCount >= MAX_REDIRECTS) {
      throw new Error('skill-download-redirect-limit')
    }
    const location = response.headers.get('location')
    if (!location) {
      throw new Error('skill-download-redirect-invalid')
    }
    const redirected = validateUrl(new URL(location, url).href, allowedOrigins, input.requireHttps)
    if (redirected.origin !== url.origin) {
      throw new Error('skill-download-cross-origin-redirect')
    }
    url = redirected
  }
}

function hashesEqual(actual: string, expected: string): boolean {
  return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'))
}

export async function downloadSkillPackageGrant(
  input: SkillPackageDownloadInput
): Promise<SkillPackageDownloadResult> {
  input.fetcher ??= fetch
  input.now ??= Date.now
  validateIdentity(input)
  const expiresAt = Date.parse(input.expiresAt)
  if (!Number.isFinite(expiresAt)) {
    throw new Error('skill-download-grant-expiry-invalid')
  }
  const allowedOrigins = new Set(
    input.allowedOrigins.map(
      (origin) => validateUrl(origin, new Set([new URL(origin).origin]), false).origin
    )
  )
  throwIfUnavailable(input, expiresAt)
  const response = await fetchWithoutCredentialRedirect(input, allowedOrigins, expiresAt)
  if (!response.ok || !response.body) {
    throw new Error('skill-download-transport-failed')
  }
  if (response.headers.get('content-type')?.split(';', 1)[0] !== SKILL_PACKAGE_CONTENT_TYPE) {
    throw new Error('skill-download-content-type-invalid')
  }
  const contentLength = response.headers.get('content-length')
  if (contentLength !== null && Number(contentLength) !== input.expectedCompressedBytes) {
    throw new Error('skill-download-size-mismatch')
  }

  await mkdir(input.temporaryRoot, { recursive: true, mode: 0o700 })
  const temporaryDirectory = await mkdtemp(join(input.temporaryRoot, '.orca-skill-download-'))
  const archivePath = join(temporaryDirectory, 'package.tar.gz')
  try {
    const handle = await open(archivePath, 'wx', 0o600)
    const reader = response.body.getReader()
    const hash = createHash('sha256')
    let compressedBytes = 0
    try {
      for (;;) {
        throwIfUnavailable(input, expiresAt)
        const chunk = await reader.read()
        if (chunk.done) {
          break
        }
        compressedBytes += chunk.value.byteLength
        if (
          compressedBytes > input.expectedCompressedBytes ||
          compressedBytes > SKILL_PACKAGE_MAX_COMPRESSED_BYTES
        ) {
          throw new Error('skill-download-size-limit')
        }
        hash.update(chunk.value)
        let offset = 0
        while (offset < chunk.value.byteLength) {
          const written = await handle.write(chunk.value, offset, chunk.value.byteLength - offset)
          if (written.bytesWritten === 0) {
            throw new Error('skill-download-write-failed')
          }
          offset += written.bytesWritten
        }
      }
      await handle.sync()
    } catch (error) {
      await reader.cancel().catch(() => undefined)
      if (input.signal?.aborted) {
        throw new Error('skill-download-cancelled')
      }
      throw error
    } finally {
      await handle.close()
    }
    if (compressedBytes !== input.expectedCompressedBytes) {
      throw new Error('skill-download-size-mismatch')
    }
    const archiveSha256 = hash.digest('hex')
    if (!hashesEqual(archiveSha256, input.expectedArchiveSha256)) {
      throw new Error('skill-download-archive-digest-mismatch')
    }
    return {
      archivePath,
      archiveSha256,
      compressedBytes,
      cleanup: () => rm(temporaryDirectory, { recursive: true, force: true })
    }
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true })
    throw error
  }
}
