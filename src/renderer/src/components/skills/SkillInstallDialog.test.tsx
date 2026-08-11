// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SkillCloudVersion } from '../../../../shared/skill-cloud-contract'
import { useAppStore } from '@/store'
import { SkillInstallDialog } from './SkillInstallDialog'

const DIGEST = 'a'.repeat(64)
const ARCHIVE_SHA = 'b'.repeat(64)

function version(): SkillCloudVersion {
  return {
    packageId: 'pkg_1',
    versionId: 'ver_1',
    name: 'private-skill',
    description: 'A private skill',
    packageDigest: DIGEST,
    archiveSha256: ARCHIVE_SHA,
    compressedBytes: 128,
    createdAt: '2026-08-11T00:00:00.000Z',
    releaseNotes: '',
    manifest: {
      schemaVersion: 1,
      packageId: 'pkg_1',
      versionId: 'ver_1',
      name: 'private-skill',
      description: 'A private skill',
      createdAt: '2026-08-11T00:00:00.000Z',
      files: [
        {
          path: 'SKILL.md',
          size: 1,
          executable: false,
          classification: 'text',
          sha256: DIGEST,
          identitySha256: DIGEST
        }
      ],
      packageDigest: DIGEST
    },
    publisher: { userId: 'author_1', organizationId: 'org_1' }
  }
}

function installApi(previewInstall: ReturnType<typeof vi.fn>) {
  return {
    resolveShare: vi
      .fn()
      .mockResolvedValue({ status: 'ok', value: { id: 'share_1', version: version() } }),
    previewInstall,
    installShare: vi.fn().mockResolvedValue({
      status: 'ok',
      value: {
        operationId: 'op_1',
        status: 'installed',
        name: 'private-skill',
        packageDigest: DIGEST,
        placements: []
      }
    }),
    cancelInstall: vi.fn().mockResolvedValue({ cancelled: true }),
    listWslDistros: vi.fn().mockResolvedValue([])
  }
}

async function inspectSkill(): Promise<void> {
  fireEvent.change(screen.getByLabelText('Orca skill link'), {
    target: { value: 'https://app.orca.dev/skills/share/share_1' }
  })
  fireEvent.click(screen.getByRole('button', { name: 'Inspect skill' }))
  await screen.findByText('A private skill')
}

beforeEach(() => {
  useAppStore.setState({
    runtimeEnvironments: [],
    runtimeStatusByEnvironmentId: new Map(),
    repos: [],
    worktreesByRepo: {},
    folderWorkspaces: [],
    sshConnectionStates: new Map(),
    sshTargetLabels: new Map()
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  Reflect.deleteProperty(window, 'api')
})

describe('SkillInstallDialog', () => {
  it('preserves a modified install until the user explicitly discards it', async () => {
    const previewInstall = vi.fn().mockResolvedValue({
      status: 'ok',
      value: {
        name: 'private-skill',
        packageDigest: DIGEST,
        destinationIdentity: 'local:global',
        currentState: 'modified',
        providers: []
      }
    })
    const skills = installApi(previewInstall)
    Object.defineProperty(window, 'api', { configurable: true, value: { skills } })
    render(<SkillInstallDialog open onOpenChange={() => undefined} />)
    await inspectSkill()

    fireEvent.click(screen.getByRole('button', { name: 'Install skill' }))
    expect((await screen.findByRole('alert')).textContent).toContain('left it untouched')
    expect(skills.installShare).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Discard and replace' }))
    await waitFor(() => expect(skills.installShare).toHaveBeenCalledOnce())
    expect(skills.installShare).toHaveBeenCalledWith(
      expect.objectContaining({ conflictResolution: 'replace-and-discard-local' })
    )
  })

  it('surfaces capability loss after preview selection without attempting installation', async () => {
    const previewInstall = vi.fn().mockResolvedValue({
      status: 'unsupported',
      message: 'Update the selected Orca host to install shared skills.'
    })
    const skills = installApi(previewInstall)
    Object.defineProperty(window, 'api', { configurable: true, value: { skills } })
    render(<SkillInstallDialog open onOpenChange={() => undefined} />)
    await inspectSkill()

    fireEvent.click(screen.getByRole('button', { name: 'Install skill' }))

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Update the selected Orca host'
    )
    expect(skills.installShare).not.toHaveBeenCalled()
  })

  it('invalidates skill discovery after a verified install', async () => {
    const previewInstall = vi.fn().mockResolvedValue({
      status: 'ok',
      value: {
        name: 'private-skill',
        packageDigest: DIGEST,
        destinationIdentity: 'local:global',
        currentState: 'missing',
        providers: []
      }
    })
    const skills = installApi(previewInstall)
    Object.defineProperty(window, 'api', { configurable: true, value: { skills } })
    const changed = vi.fn()
    window.addEventListener('orca:installed-agent-skills-changed', changed)
    render(<SkillInstallDialog open onOpenChange={() => undefined} />)
    await inspectSkill()

    fireEvent.click(screen.getByRole('button', { name: 'Install skill' }))

    await screen.findByText('Installed and verified.')
    expect(changed).toHaveBeenCalledOnce()
    window.removeEventListener('orca:installed-agent-skills-changed', changed)
  })

  it('cancels an active destination-owned install and renders the structured result', async () => {
    const previewInstall = vi.fn().mockResolvedValue({
      status: 'ok',
      value: {
        name: 'private-skill',
        packageDigest: DIGEST,
        destinationIdentity: 'local:global',
        currentState: 'missing',
        providers: []
      }
    })
    let settleInstall: ((value: unknown) => void) | undefined
    const skills = installApi(previewInstall)
    skills.installShare.mockImplementation(
      () => new Promise((resolve) => (settleInstall = resolve)) as never
    )
    Object.defineProperty(window, 'api', { configurable: true, value: { skills } })
    render(<SkillInstallDialog open onOpenChange={() => undefined} />)
    await inspectSkill()

    fireEvent.click(screen.getByRole('button', { name: 'Install skill' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel installation' }))

    await waitFor(() => expect(skills.cancelInstall).toHaveBeenCalledOnce())
    const operationId = skills.installShare.mock.calls[0]?.[0].operationId
    expect(skills.cancelInstall).toHaveBeenCalledWith({ operationId })
    settleInstall?.({
      status: 'ok',
      value: {
        operationId,
        status: 'cancelled',
        name: 'private-skill',
        packageDigest: DIGEST,
        placements: [],
        errorCategory: 'skill-install-cancelled',
        failure: { category: 'cancelled', code: 'skill-install-cancelled', retryable: true }
      }
    })
    await screen.findByText('Installation cancelled.')
    expect(screen.getByRole('button', { name: 'Retry install' })).toBeDefined()
  })
})
