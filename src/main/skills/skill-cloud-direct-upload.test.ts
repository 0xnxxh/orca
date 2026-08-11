import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { uploadSkillPackageToSignedPolicy } from './skill-cloud-direct-upload'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('uploadSkillPackageToSignedPolicy', () => {
  it('streams exact bytes with policy fields and bounded progress', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-skill-cloud-upload-'))
    roots.push(root)
    const archivePath = join(root, 'package.tar.gz')
    const archive = Buffer.from('private-package-bytes')
    await writeFile(archivePath, archive)
    let uploaded = Buffer.alloc(0)
    const fetcher = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
      const chunks: Buffer[] = []
      const body = init?.body as unknown as AsyncIterable<Buffer>
      for await (const chunk of body) {
        chunks.push(Buffer.from(chunk))
      }
      uploaded = Buffer.concat(chunks)
      expect(Number(init?.headers && new Headers(init.headers).get('content-length'))).toBe(
        uploaded.length
      )
      return new Response(null, { status: 204 })
    }) as typeof fetch
    const progress = vi.fn()

    await uploadSkillPackageToSignedPolicy({
      policy: {
        url: 'https://storage.googleapis.com/upload',
        fields: { key: 'uploads/private/package.tar.gz', policy: 'opaque-policy' }
      },
      archivePath,
      expectedBytes: archive.length,
      fetcher,
      onProgress: progress
    })

    expect(uploaded.includes(archive)).toBe(true)
    expect(uploaded.toString('utf8')).toContain('opaque-policy')
    expect(progress).toHaveBeenLastCalledWith(archive.length)
  })

  it('rejects insecure destinations and source drift before upload', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-skill-cloud-upload-'))
    roots.push(root)
    const archivePath = join(root, 'package.tar.gz')
    await writeFile(archivePath, 'bytes')
    await expect(
      uploadSkillPackageToSignedPolicy({
        policy: { url: 'http://storage.test/upload', fields: {} },
        archivePath,
        expectedBytes: 5
      })
    ).rejects.toThrow('skill-cloud-upload-url-invalid')
    await expect(
      uploadSkillPackageToSignedPolicy({
        policy: { url: 'https://storage.test/upload', fields: {} },
        archivePath,
        expectedBytes: 4
      })
    ).rejects.toThrow('skill-cloud-upload-source-changed')
  })
})
