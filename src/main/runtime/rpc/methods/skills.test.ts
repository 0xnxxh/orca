import { describe, expect, it, vi } from 'vitest'
import type { RpcContext } from '../core'

vi.mock('electron', () => ({
  app: { getPath: () => '/orca-state', isPackaged: true }
}))

vi.mock('../../../skills/skill-discovery-target', () => ({
  resolveSkillDiscoveryTarget: vi.fn((target) => ({ kind: 'native-host', cwd: target?.cwd })),
  discoverSkillsOnTarget: vi.fn(async () => ({ skills: [], sources: [], scannedAt: 1 }))
}))
import { SKILL_METHODS } from './skills'
import { resolveSkillDiscoveryTarget } from '../../../skills/skill-discovery-target'

const WSL_RUNTIME = {
  status: 'resolved',
  runtime: {
    kind: 'wsl',
    hostPlatform: 'wsl',
    projectId: 'project-1',
    distro: 'Ubuntu',
    reason: 'project-override',
    cacheKey: 'wsl:Ubuntu'
  }
} as const

function makeContext(overrides: {
  resolveProjectRuntimeForWorktree?: (worktreeId: string | null | undefined) => unknown
}): RpcContext {
  return {
    runtime: {
      listRepos: () => [],
      resolveProjectRuntimeForWorktree:
        overrides.resolveProjectRuntimeForWorktree ?? (() => undefined)
    }
  } as unknown as RpcContext
}

function discoverMethod() {
  const method = SKILL_METHODS.find((entry) => entry.name === 'skills.discover')
  if (!method) {
    throw new Error('skills.discover method not registered')
  }
  return method
}

function installMethod() {
  const method = SKILL_METHODS.find((entry) => entry.name === 'skills.install')
  if (!method) {
    throw new Error('skills.install method not registered')
  }
  return method
}

function method(name: string) {
  const value = SKILL_METHODS.find((entry) => entry.name === name)
  if (!value) {
    throw new Error(`${name} method not registered`)
  }
  return value
}

describe('skills.discover RPC', () => {
  it('resolves the project runtime from the owning runtime store when the caller omits it', async () => {
    const resolveProjectRuntimeForWorktree = vi.fn(() => WSL_RUNTIME)
    await discoverMethod().handler(
      { cwd: 'C:\\repo', worktreeId: 'worktree-1' },
      makeContext({ resolveProjectRuntimeForWorktree })
    )
    expect(resolveProjectRuntimeForWorktree).toHaveBeenCalledWith('worktree-1')
    expect(vi.mocked(resolveSkillDiscoveryTarget)).toHaveBeenLastCalledWith(
      expect.objectContaining({ projectRuntime: WSL_RUNTIME })
    )
  })

  it('prefers a caller-supplied project runtime over store resolution', async () => {
    const resolveProjectRuntimeForWorktree = vi.fn()
    await discoverMethod().handler(
      { cwd: '/repo', worktreeId: 'worktree-1', projectRuntime: WSL_RUNTIME },
      makeContext({ resolveProjectRuntimeForWorktree })
    )
    expect(resolveProjectRuntimeForWorktree).not.toHaveBeenCalled()
    expect(vi.mocked(resolveSkillDiscoveryTarget)).toHaveBeenLastCalledWith(
      expect.objectContaining({ projectRuntime: WSL_RUNTIME })
    )
  })
})

describe('skills.install RPC', () => {
  it('delegates installation to the executing runtime service', async () => {
    const installSharedSkillRequest = vi.fn(async () => ({ status: 'installed' }))
    const runtime = {
      installSharedSkillRequest
    }
    const request = {
      operationId: 'operation_1',
      package: {
        packageId: 'package_1',
        versionId: 'version_1',
        packageDigest: 'a'.repeat(64),
        archiveSha256: 'b'.repeat(64),
        compressedBytes: 100
      },
      ingress: {
        kind: 'download-grant' as const,
        url: 'https://storage.googleapis.com/package',
        expiresAt: '2026-08-11T12:00:00.000Z'
      },
      destination: { scope: 'global' as const }
    }
    await installMethod().handler(request, { runtime } as unknown as RpcContext)
    expect(installSharedSkillRequest).toHaveBeenCalledWith(request, undefined)
  })
})

describe('skill management RPC', () => {
  it('delegates preview and removal to the executing runtime', async () => {
    const previewSharedSkillInstallRequest = vi.fn(async () => ({ currentState: 'missing' }))
    const removeSharedSkillInstallRequest = vi.fn(async () => ({ status: 'removed' }))
    const runtime = { previewSharedSkillInstallRequest, removeSharedSkillInstallRequest }
    const destination = { scope: 'global' as const }
    const packageIdentity = {
      packageId: 'package_1',
      versionId: 'version_1',
      packageDigest: 'a'.repeat(64),
      archiveSha256: 'b'.repeat(64),
      compressedBytes: 100
    }

    await method('skills.previewInstall').handler(
      { name: 'example', package: packageIdentity, destination },
      { runtime } as unknown as RpcContext
    )
    await method('skills.removeInstall').handler(
      { operationId: 'operation_1', name: 'example', destination },
      { runtime } as unknown as RpcContext
    )

    expect(previewSharedSkillInstallRequest).toHaveBeenCalledOnce()
    expect(removeSharedSkillInstallRequest).toHaveBeenCalledOnce()
  })
})
