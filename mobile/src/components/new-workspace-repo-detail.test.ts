import { describe, expect, it } from 'vitest'
import { getNewWorkspaceRepoDetail } from './new-workspace-repo-detail'

describe('new workspace repository detail', () => {
  it('identifies local repositories', () => {
    expect(getNewWorkspaceRepoDetail({ path: '/src/orca' })).toBe('Local · /src/orca')
  })

  it('identifies SSH repositories by connection and path', () => {
    expect(getNewWorkspaceRepoDetail({ path: '/src/orca', connectionId: 'build-server' })).toBe(
      'SSH · build-server · /src/orca'
    )
  })

  it('uses the execution host when an SSH connection ID is absent', () => {
    expect(
      getNewWorkspaceRepoDetail({ path: 'C:\\src\\orca', executionHostId: 'ssh:Windows%20VM' })
    ).toBe('SSH · Windows VM · C:\\src\\orca')
  })

  it('distinguishes paired runtime repositories from local repositories', () => {
    expect(
      getNewWorkspaceRepoDetail({ path: '/src/orca', executionHostId: 'runtime:devbox' })
    ).toBe('Remote · devbox · /src/orca')
  })
})
