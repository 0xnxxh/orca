import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MethodHandler, RelayDispatcher } from './dispatcher'
import { createSkillPackageArchive } from '../main/skills/skill-package-creation'
import {
  SKILL_SSH_RELAY_BEGIN_UPLOAD_METHOD,
  SKILL_SSH_RELAY_COMMIT_UPLOAD_METHOD,
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
  return { archive, bytes, call, home }
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
      'skills.upload.v1',
      'skills.manage.v1'
    ])
  })
})
