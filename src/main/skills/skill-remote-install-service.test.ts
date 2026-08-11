import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SkillInstallRequest, SkillInstallResult } from '../../shared/skill-install-contract'

const mocks = vi.hoisted(() => ({
  callRuntimeEnvironment: vi.fn(),
  transferSkillPackageToRuntime: vi.fn()
}))

vi.mock('../ipc/runtime-environment-transport-routing', () => ({
  callRuntimeEnvironment: mocks.callRuntimeEnvironment
}))
vi.mock('./skill-client-mediated-transfer', () => ({
  transferSkillPackageToRuntime: mocks.transferSkillPackageToRuntime
}))

import { installSkillOnRemoteRuntime } from './skill-remote-install-service'

const request: SkillInstallRequest = {
  operationId: 'operation-1',
  package: {
    packageId: 'package-1',
    versionId: 'version-1',
    packageDigest: 'a'.repeat(64),
    archiveSha256: 'b'.repeat(64),
    compressedBytes: 12
  },
  ingress: {
    kind: 'download-grant',
    url: 'https://storage.googleapis.com/bucket/package.tar.gz',
    expiresAt: '2099-01-01T00:00:00.000Z'
  },
  destination: { scope: 'global' }
}

const result: SkillInstallResult = {
  operationId: request.operationId,
  status: 'installed',
  name: 'example',
  packageDigest: request.package.packageDigest,
  placements: []
}

function success(value: unknown) {
  return { id: 'rpc-1', ok: true, result: value, _meta: { runtimeId: 'runtime-1' } }
}

describe('installSkillOnRemoteRuntime', () => {
  beforeEach(() => {
    mocks.callRuntimeEnvironment.mockReset()
    mocks.transferSkillPackageToRuntime.mockReset()
  })

  it('uses direct remote download when the runtime can reach storage', async () => {
    mocks.callRuntimeEnvironment.mockResolvedValue(success(result))

    await expect(
      installSkillOnRemoteRuntime({
        userDataPath: '/state',
        environmentId: 'environment-1',
        request,
        capabilities: ['skills.install.v1', 'skills.upload.v1'],
        requireHttps: true
      })
    ).resolves.toEqual(result)

    expect(mocks.transferSkillPackageToRuntime).not.toHaveBeenCalled()
  })

  it('falls back to a staged client transfer and always cleans it up', async () => {
    const cleanup = vi.fn(async () => undefined)
    mocks.callRuntimeEnvironment
      .mockResolvedValueOnce({
        id: 'rpc-1',
        ok: false,
        error: { code: 'runtime_error', message: 'skill-download-transport-failed' }
      })
      .mockResolvedValueOnce(success(result))
    mocks.transferSkillPackageToRuntime.mockResolvedValue({ uploadId: 'upload-1', cleanup })

    await expect(
      installSkillOnRemoteRuntime({
        userDataPath: '/state',
        environmentId: 'environment-1',
        request,
        capabilities: ['skills.install.v1', 'skills.upload.v1'],
        requireHttps: true
      })
    ).resolves.toEqual(result)

    expect(mocks.callRuntimeEnvironment.mock.calls[1]?.[3]).toMatchObject({
      ingress: { kind: 'staged-upload', uploadId: 'upload-1' }
    })
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('does not call upload RPCs when the runtime lacks the upload capability', async () => {
    mocks.callRuntimeEnvironment.mockResolvedValue({
      id: 'rpc-1',
      ok: false,
      error: { code: 'runtime_error', message: 'skill-download-transport-failed' }
    })

    await expect(
      installSkillOnRemoteRuntime({
        userDataPath: '/state',
        environmentId: 'environment-1',
        request,
        capabilities: ['skills.install.v1'],
        requireHttps: true
      })
    ).rejects.toThrow('skill-install-remote-download-unavailable')
    expect(mocks.transferSkillPackageToRuntime).not.toHaveBeenCalled()
  })

  it('cleans the staged upload when remote installation fails', async () => {
    const cleanup = vi.fn(async () => undefined)
    mocks.callRuntimeEnvironment
      .mockResolvedValueOnce({
        id: 'rpc-1',
        ok: false,
        error: { code: 'skill-download-transport-failed', message: 'unavailable' }
      })
      .mockResolvedValueOnce({
        id: 'rpc-2',
        ok: false,
        error: { code: 'runtime_error', message: 'install failed' }
      })
    mocks.transferSkillPackageToRuntime.mockResolvedValue({ uploadId: 'upload-1', cleanup })

    await expect(
      installSkillOnRemoteRuntime({
        userDataPath: '/state',
        environmentId: 'environment-1',
        request,
        capabilities: ['skills.install.v1', 'skills.upload.v1'],
        requireHttps: true
      })
    ).rejects.toThrow('skill-install-remote-runtime_error')
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('uses the client for a configured development origin rejected by the host', async () => {
    const cleanup = vi.fn(async () => undefined)
    mocks.callRuntimeEnvironment
      .mockResolvedValueOnce({
        id: 'rpc-1',
        ok: false,
        error: { code: 'runtime_error', message: 'skill-download-origin-rejected' }
      })
      .mockResolvedValueOnce(success(result))
    mocks.transferSkillPackageToRuntime.mockResolvedValue({ uploadId: 'upload-1', cleanup })

    await expect(
      installSkillOnRemoteRuntime({
        userDataPath: '/state',
        environmentId: 'environment-1',
        request,
        capabilities: ['skills.install.v1', 'skills.upload.v1'],
        requireHttps: false
      })
    ).resolves.toEqual(result)
    expect(mocks.transferSkillPackageToRuntime).toHaveBeenCalledOnce()
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('preserves packaged-host policy rejection without attempting transfer', async () => {
    mocks.callRuntimeEnvironment.mockResolvedValue({
      id: 'rpc-1',
      ok: false,
      error: { code: 'runtime_error', message: 'skill-download-origin-rejected' }
    })

    await expect(
      installSkillOnRemoteRuntime({
        userDataPath: '/state',
        environmentId: 'environment-1',
        request,
        capabilities: ['skills.install.v1', 'skills.upload.v1'],
        requireHttps: true
      })
    ).rejects.toThrow('skill-install-remote-runtime_error')
    expect(mocks.transferSkillPackageToRuntime).not.toHaveBeenCalled()
  })
})
