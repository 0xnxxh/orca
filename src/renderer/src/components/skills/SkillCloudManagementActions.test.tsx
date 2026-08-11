// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SkillCloudPackageDetails } from '../../../../shared/skill-cloud-contract'
import { SkillCloudManagementActions } from './SkillCloudManagementActions'

const details: SkillCloudPackageDetails = {
  id: 'pkg_1',
  name: 'private-skill',
  description: 'Private skill',
  createdAt: '2026-08-11T00:00:00.000Z',
  canManage: true,
  versions: [],
  management: {
    userIds: ['legacy_user'],
    shareWithOrganization: false,
    shares: [
      {
        id: 'share_1',
        pinnedVersionId: 'ver_1',
        createdAt: '2026-08-11T00:00:00.000Z'
      }
    ]
  }
}

function setup() {
  const skills = {
    replacePackageAccess: vi.fn().mockResolvedValue({ status: 'ok', value: undefined }),
    revokeShare: vi.fn().mockResolvedValue({ status: 'ok', value: undefined }),
    deletePackageVersion: vi.fn().mockResolvedValue({ status: 'ok', value: undefined }),
    deletePackage: vi.fn().mockResolvedValue({ status: 'ok', value: undefined })
  }
  const onChanged = vi.fn().mockResolvedValue(undefined)
  const onPackageDeleted = vi.fn()
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      skills,
      orcaProfiles: {
        authStatus: vi.fn().mockResolvedValue({
          cloud: { userId: 'viewer', activeOrgId: 'org_1' }
        }),
        orgMembersList: vi.fn().mockResolvedValue({
          status: 'ok',
          roster: {
            members: [
              {
                userId: 'user_2',
                email: 'teammate@example.com',
                displayName: 'Teammate',
                role: 'member'
              }
            ]
          }
        })
      }
    }
  })
  render(
    <SkillCloudManagementActions
      details={details}
      selectedVersionId="ver_1"
      onChanged={onChanged}
      onPackageDeleted={onPackageDeleted}
    />
  )
  return { skills, onChanged, onPackageDeleted }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  Reflect.deleteProperty(window, 'api')
})

describe('SkillCloudManagementActions', () => {
  it('saves organization and selected-user access while preserving unknown recipients', async () => {
    const { skills, onChanged } = setup()
    const organization = await screen.findByRole('checkbox', { name: 'Current organization' })
    await waitFor(() => expect((organization as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(organization)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Teammate' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save access' }))

    await waitFor(() => expect(skills.replacePackageAccess).toHaveBeenCalledOnce())
    expect(skills.replacePackageAccess).toHaveBeenCalledWith({
      packageId: 'pkg_1',
      userIds: ['legacy_user', 'user_2'],
      shareWithOrganization: true
    })
    expect(onChanged).toHaveBeenCalledOnce()
  })

  it('requires confirmation before revoking an active link', async () => {
    const { skills } = setup()
    expect(screen.getByText(/Copies already installed on any machine remain there\./)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Unshare' }))
    expect(skills.revokeShare).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm unshare' }))

    await waitFor(() => expect(skills.revokeShare).toHaveBeenCalledWith('share_1'))
  })

  it('requires confirmation before deleting the selected immutable version', async () => {
    const { skills } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected Cloud version' }))
    expect(skills.deletePackageVersion).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm version deletion' }))

    await waitFor(() =>
      expect(skills.deletePackageVersion).toHaveBeenCalledWith({
        packageId: 'pkg_1',
        versionId: 'ver_1'
      })
    )
  })

  it('requires confirmation before deleting the Cloud package', async () => {
    const { skills, onChanged, onPackageDeleted } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Delete Cloud package' }))
    expect(skills.deletePackage).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm package deletion' }))

    await waitFor(() => expect(skills.deletePackage).toHaveBeenCalledWith('pkg_1'))
    expect(onPackageDeleted).toHaveBeenCalledOnce()
    expect(onChanged).not.toHaveBeenCalled()
  })
})
