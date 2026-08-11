// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ManagedSkillInstall } from '../../../../shared/skill-install-contract'
import type {
  SkillCloudPackageDetails,
  SkillCloudVersion
} from '../../../../shared/skill-cloud-contract'
import { useAppStore } from '@/store'
import { SkillInstallManagementDialog } from './SkillInstallManagementDialog'

const DIGEST = 'a'.repeat(64)
const ARCHIVE_SHA = 'b'.repeat(64)

function version(versionId: string, createdAt: string): SkillCloudVersion {
  return {
    packageId: 'pkg_1',
    versionId,
    name: 'private-skill',
    description: 'Private skill',
    packageDigest: DIGEST,
    archiveSha256: ARCHIVE_SHA,
    compressedBytes: 128,
    createdAt,
    releaseNotes: '',
    manifest: {
      schemaVersion: 1,
      packageId: 'pkg_1',
      versionId,
      name: 'private-skill',
      description: 'Private skill',
      createdAt,
      files: [],
      packageDigest: DIGEST
    }
  }
}

function install(versionId: string): ManagedSkillInstall {
  return {
    name: 'private-skill',
    packageId: 'pkg_1',
    versionId,
    packageDigest: DIGEST,
    scope: 'global',
    destinationIdentity: 'global:local',
    destination: { scope: 'global' },
    installedAt: '2026-08-11T00:00:00.000Z',
    state: 'unchanged'
  }
}

function packageDetails(versions: SkillCloudVersion[]): SkillCloudPackageDetails {
  return {
    id: 'pkg_1',
    name: 'private-skill',
    description: 'Private skill',
    createdAt: versions.at(-1)?.createdAt ?? '2026-08-11T00:00:00.000Z',
    canManage: true,
    versions
  }
}

function skillsApi(installed: ManagedSkillInstall, versions: SkillCloudVersion[]) {
  return {
    listManagedInstalls: vi.fn().mockResolvedValue({ status: 'ok', value: [installed] }),
    getPackage: vi.fn().mockResolvedValue({ status: 'ok', value: packageDetails(versions) }),
    installPackageVersion: vi.fn().mockResolvedValue({
      status: 'ok',
      value: {
        operationId: 'operation_1',
        status: 'updated',
        name: installed.name,
        packageDigest: DIGEST,
        placements: []
      }
    }),
    removeInstall: vi.fn().mockResolvedValue({
      status: 'ok',
      value: {
        operationId: 'operation_2',
        status: 'removed',
        name: installed.name,
        packageDigest: DIGEST,
        placements: []
      }
    })
  }
}

async function selectInstall(versionId: string): Promise<void> {
  await screen.findByText(`global · ${versionId}`)
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`private-skill.*${versionId}`) }))
  await screen.findByText(`Installed version ${versionId}`)
}

beforeEach(() => {
  useAppStore.setState({
    runtimeEnvironments: [],
    sshConnectionStates: new Map(),
    sshTargetLabels: new Map()
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  Reflect.deleteProperty(window, 'api')
})

describe('SkillInstallManagementDialog', () => {
  it('updates an installed skill to the newest immutable version', async () => {
    const skills = skillsApi(install('ver_1'), [
      version('ver_2', '2026-08-12T00:00:00.000Z'),
      version('ver_1', '2026-08-11T00:00:00.000Z')
    ])
    Object.defineProperty(window, 'api', { configurable: true, value: { skills } })
    render(<SkillInstallManagementDialog open onOpenChange={() => undefined} />)
    await selectInstall('ver_1')

    fireEvent.click(screen.getByRole('button', { name: 'Install selected version' }))

    await waitFor(() => expect(skills.installPackageVersion).toHaveBeenCalledOnce())
    expect(skills.installPackageVersion).toHaveBeenCalledWith(
      expect.objectContaining({ packageId: 'pkg_1', versionId: 'ver_2' })
    )
  })

  it('rolls an installed skill back to an older immutable version', async () => {
    const skills = skillsApi(install('ver_2'), [
      version('ver_1', '2026-08-11T00:00:00.000Z'),
      version('ver_2', '2026-08-12T00:00:00.000Z')
    ])
    Object.defineProperty(window, 'api', { configurable: true, value: { skills } })
    render(<SkillInstallManagementDialog open onOpenChange={() => undefined} />)
    await selectInstall('ver_2')

    fireEvent.click(screen.getByRole('button', { name: 'Install selected version' }))

    await waitFor(() => expect(skills.installPackageVersion).toHaveBeenCalledOnce())
    expect(skills.installPackageVersion).toHaveBeenCalledWith(
      expect.objectContaining({ packageId: 'pkg_1', versionId: 'ver_1' })
    )
  })

  it('requires confirmation before removing an Orca-managed install', async () => {
    const skills = skillsApi(install('ver_2'), [version('ver_2', '2026-08-12T00:00:00.000Z')])
    Object.defineProperty(window, 'api', { configurable: true, value: { skills } })
    render(<SkillInstallManagementDialog open onOpenChange={() => undefined} />)
    await selectInstall('ver_2')

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(skills.removeInstall).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm remove' }))

    await waitFor(() => expect(skills.removeInstall).toHaveBeenCalledOnce())
    expect(skills.removeInstall).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'private-skill', destination: { scope: 'global' } })
    )
  })
})
