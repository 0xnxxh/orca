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
    shares: [
      {
        id: 'share_1',
        url: 'https://share.test/skills/share/share_1',
        pinnedVersionId: 'ver_1',
        createdAt: '2026-08-11T00:00:00.000Z'
      }
    ]
  }
}

function setup() {
  const skills = {
    revokeShare: vi.fn().mockResolvedValue({ status: 'ok', value: undefined }),
    deletePackageVersion: vi.fn().mockResolvedValue({ status: 'ok', value: undefined }),
    deletePackage: vi.fn().mockResolvedValue({ status: 'ok', value: undefined })
  }
  const writeClipboardText = vi.fn().mockResolvedValue(undefined)
  const onChanged = vi.fn().mockResolvedValue(undefined)
  const onPackageDeleted = vi.fn()
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      skills,
      ui: { writeClipboardText }
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
  return { skills, onChanged, onPackageDeleted, writeClipboardText }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  Reflect.deleteProperty(window, 'api')
})

describe('SkillCloudManagementActions', () => {
  it('requires confirmation before revoking an active link', async () => {
    const { skills } = setup()
    expect(screen.getByText(/leaves installed copies unchanged/)).toBeTruthy()
    expect(screen.queryByText('Access')).toBeNull()
    const unshare = screen.getByRole('button', { name: 'Unshare' })
    unshare.focus()
    fireEvent.click(unshare)
    expect(skills.revokeShare).not.toHaveBeenCalled()
    const confirm = screen.getByRole('button', { name: 'Confirm unshare' })
    expect(document.activeElement).toBe(confirm)
    fireEvent.click(confirm)

    await waitFor(() => expect(skills.revokeShare).toHaveBeenCalledWith('share_1'))
  })

  it('copies an active unlisted link', async () => {
    const { writeClipboardText } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
    await waitFor(() =>
      expect(writeClipboardText).toHaveBeenCalledWith('https://share.test/skills/share/share_1')
    )
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
