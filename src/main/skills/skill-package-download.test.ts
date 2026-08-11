import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SKILL_PACKAGE_CONTENT_TYPE } from '../../shared/skill-package-manifest'
import { downloadSkillPackageGrant } from './skill-package-download'

const roots: string[] = []
const bytes = Buffer.from('private skill package')
const digest = createHash('sha256').update(bytes).digest('hex')

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'orca-skill-download-test-'))
  roots.push(root)
  return root
}

function response(body: BodyInit | null, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  if (body && !headers.has('content-type')) {
    headers.set('content-type', SKILL_PACKAGE_CONTENT_TYPE)
  }
  return new Response(body, { ...init, headers })
}

function fetcher(implementation: (url: string) => Promise<Response>): typeof fetch {
  return vi.fn(async (input) => implementation(String(input))) as typeof fetch
}

async function input(overrides: Record<string, unknown> = {}) {
  return {
    url: 'https://storage.test/package.tar.gz?signature=private',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    expectedArchiveSha256: digest,
    expectedCompressedBytes: bytes.length,
    temporaryRoot: await temporaryRoot(),
    allowedOrigins: ['https://storage.test'],
    requireHttps: true,
    fetcher: fetcher(async () => response(bytes)),
    ...overrides
  }
}

describe('downloadSkillPackageGrant', () => {
  it('streams a verified package into an owner-private temporary file', async () => {
    const result = await downloadSkillPackageGrant(await input())
    expect(await readFile(result.archivePath)).toEqual(bytes)
    expect(result.archiveSha256).toBe(digest)
    expect(result.compressedBytes).toBe(bytes.length)
    await result.cleanup()
    await expect(readFile(result.archivePath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects untrusted origins and insecure grant URLs before fetch', async () => {
    const untrusted = await input({ url: 'https://attacker.test/package.tar.gz' })
    await expect(downloadSkillPackageGrant(untrusted)).rejects.toThrow(
      'skill-download-origin-rejected'
    )
    expect(untrusted.fetcher).not.toHaveBeenCalled()

    const insecure = await input({
      url: 'http://storage.test/package.tar.gz',
      allowedOrigins: ['http://storage.test']
    })
    await expect(downloadSkillPackageGrant(insecure)).rejects.toThrow('skill-download-url-rejected')
  })

  it('allows same-origin redirects but rejects signed cross-origin redirects', async () => {
    const sameOriginFetch = fetcher(async (url) =>
      url.includes('/first')
        ? response(null, { status: 307, headers: { location: '/second' } })
        : response(bytes)
    )
    const result = await downloadSkillPackageGrant(
      await input({
        url: 'https://storage.test/first?signature=private',
        fetcher: sameOriginFetch
      })
    )
    expect(sameOriginFetch).toHaveBeenCalledTimes(2)
    await result.cleanup()

    const crossOriginFetch = fetcher(async () =>
      response(null, {
        status: 307,
        headers: { location: 'https://other.test/package.tar.gz' }
      })
    )
    await expect(
      downloadSkillPackageGrant(
        await input({
          fetcher: crossOriginFetch,
          allowedOrigins: ['https://storage.test', 'https://other.test']
        })
      )
    ).rejects.toThrow('skill-download-cross-origin-redirect')
  })

  it('deletes partial bytes after size and digest failures', async () => {
    const sizeInput = await input({
      expectedCompressedBytes: bytes.length - 1,
      fetcher: fetcher(async () => response(bytes))
    })
    await expect(downloadSkillPackageGrant(sizeInput)).rejects.toThrow('skill-download-size-limit')
    expect(await readdir(sizeInput.temporaryRoot)).toEqual([])

    const digestInput = await input({ expectedArchiveSha256: '0'.repeat(64) })
    await expect(downloadSkillPackageGrant(digestInput)).rejects.toThrow(
      'skill-download-archive-digest-mismatch'
    )
    expect(await readdir(digestInput.temporaryRoot)).toEqual([])
  })

  it('rejects expired grants without network access', async () => {
    const expired = await input({ expiresAt: new Date(Date.now() - 1).toISOString() })
    await expect(downloadSkillPackageGrant(expired)).rejects.toThrow('skill-download-grant-expired')
    expect(expired.fetcher).not.toHaveBeenCalled()
  })
})
