// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ManagedSkillInstall } from '../../../../shared/skill-install-contract'
import type {
  SkillSharePreview,
  SkillShareProgress
} from '../../../../shared/skill-sharing-contract'
import type { DiscoveredSkill } from '../../../../shared/skills'
import { SkillShareDialog } from './SkillShareDialog'

const skill: DiscoveredSkill = {
  id: 'home:private-skill',
  name: 'private-skill',
  description: 'Private skill',
  providers: ['codex'],
  sourceKind: 'home',
  sourceLabel: 'Home',
  rootPath: '/home/skills',
  directoryPath: '/home/skills/private-skill',
  skillFilePath: '/home/skills/private-skill/SKILL.md',
  installed: true,
  fileCount: 1,
  updatedAt: null
}

const preview: SkillSharePreview = {
  preparationId: '11111111-1111-4111-8111-111111111111',
  packageId: 'pkg_1',
  versionId: 'ver_2',
  name: 'private-skill',
  description: 'Private skill',
  packageDigest: 'a'.repeat(64),
  archiveSha256: 'b'.repeat(64),
  fileCount: 1,
  totalBytes: 128,
  compressedBytes: 96,
  scriptPaths: [],
  executablePaths: [],
  expiresAt: '2026-08-11T01:00:00.000Z'
}

function managedInstall(destinationIdentity: string): ManagedSkillInstall {
  return {
    name: 'private-skill',
    packageId: 'pkg_1',
    versionId: 'ver_1',
    packageDigest: 'c'.repeat(64),
    scope: 'global',
    destinationIdentity,
    destination: { scope: 'global' },
    installedAt: '2026-08-11T00:00:00.000Z',
    state: 'unchanged'
  }
}

function setup(installs: ManagedSkillInstall[], organization = false) {
  let progressListener: ((progress: SkillShareProgress) => void) | null = null
  const skills = {
    listManagedInstalls: vi.fn().mockResolvedValue({ status: 'ok', value: installs }),
    prepareShare: vi.fn().mockResolvedValue(preview),
    publishShare: vi.fn(),
    cancelShare: vi.fn().mockResolvedValue(undefined),
    releaseShare: vi.fn().mockResolvedValue(undefined),
    onShareProgress: vi.fn((listener) => {
      progressListener = listener
      return () => undefined
    })
  }
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      skills,
      orcaProfiles: {
        authStatus: vi.fn().mockResolvedValue({
          cloud: {
            email: 'owner@example.com',
            ...(organization ? { activeOrgId: 'org_1', activeOrgName: 'Orca' } : {})
          }
        }),
        orgMembersList: vi.fn().mockResolvedValue({
          status: 'ok',
          roster: { members: [] }
        })
      }
    }
  })
  render(<SkillShareDialog skill={skill} open onOpenChange={() => undefined} />)
  return {
    skills,
    emitProgress: (progress: SkillShareProgress) => progressListener?.(progress)
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  Reflect.deleteProperty(window, 'api')
})

describe('SkillShareDialog', () => {
  it('publishes a new immutable version for one exact managed-install match', async () => {
    const { skills } = setup([managedInstall('global:local')])

    await screen.findByRole('heading', { name: 'Publish new skill version' })
    expect(screen.getByRole('button', { name: 'Publish new version' })).toBeTruthy()
    expect(skills.prepareShare).toHaveBeenCalledWith({
      skillId: skill.id,
      packageId: 'pkg_1'
    })
  })

  it('does not choose a package when managed-install matching is ambiguous', async () => {
    const { skills } = setup([
      managedInstall('global:local'),
      managedInstall('global:other-environment')
    ])

    await screen.findByRole('heading', { name: 'Share skill' })
    await waitFor(() =>
      expect(skills.prepareShare).toHaveBeenCalledWith({
        skillId: skill.id
      })
    )
  })

  it('shows bounded upload progress and supports cancellation', async () => {
    let rejectPublish: (error: Error) => void = () => undefined
    const { skills, emitProgress } = setup([], true)
    skills.publishShare.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectPublish = reject
      })
    )
    await screen.findByRole('heading', { name: 'Share skill' })

    fireEvent.click(screen.getByRole('button', { name: 'Publish skill' }))
    await screen.findByRole('button', { name: 'Cancel upload' })
    emitProgress({
      preparationId: preview.preparationId,
      phase: 'uploading',
      bytesSent: 48,
      totalBytes: 96
    })
    await screen.findByText('50%')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel upload' }))
    await waitFor(() => expect(skills.cancelShare).toHaveBeenCalledWith(preview.preparationId))
    rejectPublish(new Error('aborted'))

    await screen.findByText('Upload cancelled. The prepared copy is still available to retry.')
  })
})
