import { afterEach, describe, expect, it } from 'vitest'
import {
  clearWebSessionBrowserPlacementsForEnvironment,
  clearWebSessionBrowserPlacementsForWorktree,
  getWebSessionBrowserPlacementGroup,
  isWebSessionBrowserPlacementGroupReserved,
  recordWebSessionBrowserPlacement,
  reserveWebSessionBrowserPlacementGroup,
  resetWebSessionBrowserPlacementsForTests
} from './web-session-browser-placement'

const ENVIRONMENT_ID = 'environment-1'
const WORKTREE_ID = 'worktree-1'

afterEach(resetWebSessionBrowserPlacementsForTests)

describe('web session browser placement', () => {
  it('bounds pending page placements and group reservations', () => {
    for (let index = 0; index < 129; index += 1) {
      recordWebSessionBrowserPlacement({
        environmentId: ENVIRONMENT_ID,
        worktreeId: WORKTREE_ID,
        remotePageId: `page-${index}`,
        groupId: `group-${index}`
      })
      reserveWebSessionBrowserPlacementGroup({
        environmentId: ENVIRONMENT_ID,
        worktreeId: WORKTREE_ID,
        groupId: `group-${index}`
      })
    }

    expect(
      getWebSessionBrowserPlacementGroup({
        environmentId: ENVIRONMENT_ID,
        worktreeId: WORKTREE_ID,
        remotePageId: 'page-0'
      })
    ).toBeUndefined()
    expect(
      isWebSessionBrowserPlacementGroupReserved({
        environmentId: ENVIRONMENT_ID,
        worktreeId: WORKTREE_ID,
        groupId: 'group-0'
      })
    ).toBe(false)
    expect(
      getWebSessionBrowserPlacementGroup({
        environmentId: ENVIRONMENT_ID,
        worktreeId: WORKTREE_ID,
        remotePageId: 'page-128'
      })
    ).toBe('group-128')
  })

  it('clears only the requested worktree or environment', () => {
    for (const [environmentId, worktreeId, suffix] of [
      [ENVIRONMENT_ID, WORKTREE_ID, 'target'],
      [ENVIRONMENT_ID, 'worktree-2', 'sibling'],
      ['environment-2', WORKTREE_ID, 'other-environment']
    ] as const) {
      recordWebSessionBrowserPlacement({
        environmentId,
        worktreeId,
        remotePageId: `page-${suffix}`,
        groupId: `group-${suffix}`
      })
      reserveWebSessionBrowserPlacementGroup({
        environmentId,
        worktreeId,
        groupId: `group-${suffix}`
      })
    }

    clearWebSessionBrowserPlacementsForWorktree(ENVIRONMENT_ID, WORKTREE_ID)

    expect(
      getWebSessionBrowserPlacementGroup({
        environmentId: ENVIRONMENT_ID,
        worktreeId: WORKTREE_ID,
        remotePageId: 'page-target'
      })
    ).toBeUndefined()
    expect(
      getWebSessionBrowserPlacementGroup({
        environmentId: ENVIRONMENT_ID,
        worktreeId: 'worktree-2',
        remotePageId: 'page-sibling'
      })
    ).toBe('group-sibling')

    clearWebSessionBrowserPlacementsForEnvironment('environment-2')

    expect(
      getWebSessionBrowserPlacementGroup({
        environmentId: 'environment-2',
        worktreeId: WORKTREE_ID,
        remotePageId: 'page-other-environment'
      })
    ).toBeUndefined()
  })
})
