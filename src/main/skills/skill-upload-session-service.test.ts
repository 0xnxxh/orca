import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SkillUploadSessionService } from './skill-upload-session-service'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function identity(bytes: Buffer) {
  return {
    packageId: 'package_1',
    versionId: 'version_1',
    packageDigest: 'a'.repeat(64),
    archiveSha256: createHash('sha256').update(bytes).digest('hex'),
    compressedBytes: bytes.length
  }
}

describe('SkillUploadSessionService', () => {
  it('accepts monotonic chunks, acknowledges identical retries, and transfers ownership', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-skill-upload-session-'))
    roots.push(root)
    const service = new SkillUploadSessionService(join(root, 'uploads'))
    const bytes = Buffer.from('immutable skill package')
    const packageIdentity = identity(bytes)
    const begun = await service.begin({ package: packageIdentity })
    const first = bytes.subarray(0, 8)
    const second = bytes.subarray(8)

    await expect(
      service.append({ uploadId: begun.uploadId, offset: 0, bytesBase64: first.toString('base64') })
    ).resolves.toEqual({ acknowledgedOffset: first.length })
    await expect(
      service.append({ uploadId: begun.uploadId, offset: 0, bytesBase64: first.toString('base64') })
    ).resolves.toEqual({ acknowledgedOffset: first.length })
    await service.append({
      uploadId: begun.uploadId,
      offset: first.length,
      bytesBase64: second.toString('base64')
    })
    await service.commit(begun.uploadId)
    const staged = await service.take(begun.uploadId, packageIdentity)
    await expect(readFile(staged.archivePath)).resolves.toEqual(bytes)
    await staged.cleanup()
    await expect(readFile(staged.archivePath)).rejects.toThrow()
  })

  it('rejects gaps, changed retries, and an archive hash mismatch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-skill-upload-session-'))
    roots.push(root)
    const service = new SkillUploadSessionService(join(root, 'uploads'))
    const bytes = Buffer.from('package')
    const packageIdentity = identity(bytes)
    const begun = await service.begin({ package: packageIdentity })
    await expect(
      service.append({ uploadId: begun.uploadId, offset: 1, bytesBase64: 'YQ==' })
    ).rejects.toThrow('skill-upload-offset-invalid')
    await service.append({ uploadId: begun.uploadId, offset: 0, bytesBase64: 'YQ==' })
    await expect(
      service.append({ uploadId: begun.uploadId, offset: 0, bytesBase64: 'Yg==' })
    ).rejects.toThrow('skill-upload-retry-mismatch')
    await service.append({
      uploadId: begun.uploadId,
      offset: 1,
      bytesBase64: Buffer.from('xxxxxx').toString('base64')
    })
    await expect(service.commit(begun.uploadId)).rejects.toThrow(
      'skill-upload-archive-hash-mismatch'
    )
  })
})
