import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MethodHandler, RelayDispatcher } from './dispatcher'
import { createSkillPackageArchive } from '../main/skills/skill-package-creation'
import { createSkillBundleArchive } from '../main/skills/skill-bundle-creation'
import {
  SKILL_SSH_RELAY_BEGIN_UPLOAD_METHOD,
  SKILL_SSH_RELAY_COMMIT_UPLOAD_METHOD,
  SKILL_SSH_RELAY_INSTALL_BUNDLE_METHOD,
  SKILL_SSH_RELAY_INSTALL_METHOD,
  SKILL_SSH_RELAY_UPLOAD_CHUNK_METHOD
} from '../shared/skill-ssh-relay-contract'
import { SKILL_RELAY_CAPABILITIES, SkillInstallHandler } from './skill-install-handler'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'orca-relay-skill-test-'))
  roots.push(root)
  const home = join(root, 'home')
  const state = join(root, 'state')
  const source = join(root, 'source')
  await Promise.all([mkdir(home), mkdir(source)])
  await writeFile(
    join(source, 'SKILL.md'),
    '---\nname: relay-skill\ndescription: Relay test\n---\n\n# Relay\n'
  )
  const archive = await createSkillPackageArchive({
    sourceDirectory: source,
    archivePath: join(root, 'package.tar.gz'),
    packageId: 'package_1',
    versionId: 'version_1'
  })
  const bytes = await readFile(archive.archivePath)
  const handlers = new Map<string, MethodHandler>()
  const dispatcher = {
    onRequest: vi.fn((method: string, handler: MethodHandler) => handlers.set(method, handler))
  } as unknown as RelayDispatcher
  new SkillInstallHandler(dispatcher, {
    homeDirectory: home,
    stateDirectory: state,
    detectProviders: async () => []
  })
  const call = (method: string, params: Record<string, unknown>) =>
    handlers.get(method)!(params, {
      clientId: 1,
      isStale: () => false,
      signal: new AbortController().signal
    })
  return { archive, bytes, call, home, root }
}

describe('SkillInstallHandler', () => {
  it('installs a client-mediated package entirely on the SSH host', async () => {
    const { archive, bytes, call, home } = await fixture()
    const packageIdentity = {
      packageId: archive.manifest.packageId,
      versionId: archive.manifest.versionId,
      packageDigest: archive.manifest.packageDigest,
      archiveSha256: archive.archiveSha256,
      compressedBytes: bytes.length
    }
    const begun = (await call(SKILL_SSH_RELAY_BEGIN_UPLOAD_METHOD, {
      package: packageIdentity
    })) as { uploadId: string }
    await call(SKILL_SSH_RELAY_UPLOAD_CHUNK_METHOD, {
      uploadId: begun.uploadId,
      offset: 0,
      bytesBase64: bytes.toString('base64')
    })
    await call(SKILL_SSH_RELAY_COMMIT_UPLOAD_METHOD, { uploadId: begun.uploadId })

    const result = (await call(SKILL_SSH_RELAY_INSTALL_METHOD, {
      request: {
        operationId: 'operation_1',
        package: packageIdentity,
        ingress: { kind: 'staged-upload', uploadId: begun.uploadId },
        destination: { scope: 'global', executionTarget: { kind: 'host' } }
      }
    })) as { status: string }

    expect(result.status).toBe('installed')
    expect(
      await readFile(join(home, '.agents', 'skills', 'relay-skill', 'SKILL.md'), 'utf8')
    ).toContain('# Relay')
  })

  it('advertises separately gateable install, upload, and management capabilities', () => {
    expect(SKILL_RELAY_CAPABILITIES).toEqual([
      'skills.install.v1',
      'skills.install.bundle.v1',
      'skills.upload.v1',
      'skills.manage.v1'
    ])
  })

  it('installs a selected bundle through the additive SSH method', async () => {
    const { call, home, root } = await fixture()
    const alpha = join(root, 'alpha-skill')
    const beta = join(root, 'beta-skill')
    await Promise.all([mkdir(alpha), mkdir(beta)])
    await writeFile(join(alpha, 'SKILL.md'), '---\nname: alpha-skill\ndescription: Alpha\n---\n')
    await writeFile(join(beta, 'SKILL.md'), '---\nname: beta-skill\ndescription: Beta\n---\n')
    const bundle = await createSkillBundleArchive({
      sources: [{ sourceDirectory: alpha }, { sourceDirectory: beta }],
      archivePath: join(root, 'bundle.tar.gz'),
      packageId: 'bundle_package',
      versionId: 'bundle_version',
      bundleName: 'relay-bundle'
    })
    const bundleBytes = await readFile(bundle.archivePath)
    const packageIdentity = {
      packageId: bundle.manifest.packageId,
      versionId: bundle.manifest.versionId,
      bundleDigest: bundle.manifest.bundleDigest,
      archiveSha256: bundle.archiveSha256,
      compressedBytes: bundleBytes.length
    }
    const begun = (await call(SKILL_SSH_RELAY_BEGIN_UPLOAD_METHOD, {
      package: packageIdentity
    })) as { uploadId: string }
    await call(SKILL_SSH_RELAY_UPLOAD_CHUNK_METHOD, {
      uploadId: begun.uploadId,
      offset: 0,
      bytesBase64: bundleBytes.toString('base64')
    })
    await call(SKILL_SSH_RELAY_COMMIT_UPLOAD_METHOD, { uploadId: begun.uploadId })
    const alphaId = bundle.manifest.skills.find((skill) => skill.name === 'alpha-skill')!.id

    const result = (await call(SKILL_SSH_RELAY_INSTALL_BUNDLE_METHOD, {
      request: {
        operationId: 'bundle_operation',
        package: packageIdentity,
        selectedSkillIds: [alphaId],
        ingress: { kind: 'staged-upload', uploadId: begun.uploadId },
        destination: { scope: 'global', executionTarget: { kind: 'host' } },
        conflictDecisions: []
      }
    })) as { status: string; skills: { name: string }[] }

    expect(result).toMatchObject({ status: 'complete', skills: [{ name: 'alpha-skill' }] })
    await expect(
      readFile(join(home, '.agents', 'skills', 'alpha-skill', 'SKILL.md'))
    ).resolves.toBeDefined()
    await expect(
      readFile(join(home, '.agents', 'skills', 'beta-skill', 'SKILL.md'))
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('exposes invalid staged archives through the stable SSH failure contract', async () => {
    const { call } = await fixture()
    const bytes = Buffer.from('not a skill archive')
    const packageIdentity = {
      packageId: 'package_1',
      versionId: 'version_1',
      packageDigest: 'a'.repeat(64),
      archiveSha256: createHash('sha256').update(bytes).digest('hex'),
      compressedBytes: bytes.length
    }
    const begun = (await call(SKILL_SSH_RELAY_BEGIN_UPLOAD_METHOD, {
      package: packageIdentity
    })) as { uploadId: string }
    await call(SKILL_SSH_RELAY_UPLOAD_CHUNK_METHOD, {
      uploadId: begun.uploadId,
      offset: 0,
      bytesBase64: bytes.toString('base64')
    })
    await call(SKILL_SSH_RELAY_COMMIT_UPLOAD_METHOD, { uploadId: begun.uploadId })

    await expect(
      call(SKILL_SSH_RELAY_INSTALL_METHOD, {
        request: {
          operationId: 'operation_invalid',
          package: packageIdentity,
          ingress: { kind: 'staged-upload', uploadId: begun.uploadId },
          destination: { scope: 'global', executionTarget: { kind: 'host' } }
        }
      })
    ).rejects.toMatchObject({
      code: 'skill_install_failure',
      data: { category: 'archive', retryable: false }
    })
  })
})
