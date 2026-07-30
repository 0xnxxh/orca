import { describe, expect, it } from 'vitest'
import type { GitRepositorySnapshot } from '../../../../shared/git-repository-snapshot'
import {
  buildChecksPanelGitStatusContextKey,
  readChecksPanelRepositorySnapshot,
  readChecksPanelPublishActionGitStatus,
  readChecksPanelRefreshGitIdentitySnapshot,
  readChecksPanelGitStatusSnapshot,
  hasChecksPanelGitStatusBranchChanged,
  shouldClearChecksPanelGitStatusSnapshot,
  shouldCoalesceChecksPanelGitStatusSnapshotRefresh,
  shouldCommitChecksPanelGitStatusSnapshot,
  shouldPollChecksPanelRuntimeSshStatus,
  type ChecksPanelGitStatusSnapshot
} from './checks-panel-git-status-snapshot'

const SNAPSHOT: ChecksPanelGitStatusSnapshot = {
  contextKey: 'runtime:env-1::repo::worktree::branch',
  hasUncommittedChanges: true,
  remoteStatus: {
    hasUpstream: false,
    ahead: 0,
    behind: 0
  },
  gitIdentity: {
    head: 'abc123',
    branch: 'refs/heads/feature/checks'
  }
}

function repositorySnapshot(overrides: Partial<GitRepositorySnapshot> = {}): GitRepositorySnapshot {
  const freshness = {
    state: 'fresh' as const,
    generation: 2,
    currentGeneration: 2,
    revision: 4,
    identity: 'identity'
  }
  return {
    revision: 4,
    generatedAt: 100,
    repositoryIdentity: { head: 'abc123', branch: 'feature/checks' },
    status: {
      entries: [{ path: 'src/app.ts', status: 'modified', area: 'unstaged' }],
      didHitLimit: false,
      statusLength: 1,
      ignoredPaths: [],
      lineStatsState: 'complete',
      retentionTruncated: false
    },
    upstream: { hasUpstream: true, upstreamName: 'origin/main', ahead: 1, behind: 0 },
    conflicts: null,
    worktreeGraphVersion: 0,
    freshness: {
      repositoryIdentity: freshness,
      status: freshness,
      upstream: freshness,
      conflicts: freshness,
      worktreeGraph: { ...freshness, state: 'placeholder' }
    },
    ...overrides
  }
}

describe('buildChecksPanelGitStatusContextKey', () => {
  it('changes when an explicit push target changes', () => {
    const base = {
      repoId: 'repo-1',
      worktreeId: 'worktree-1',
      worktreePath: 'repo-worktree',
      branch: 'feature/checks',
      runtimeEnvironmentId: 'runtime-1',
      repoConnectionId: 'ssh-1'
    }

    expect(
      buildChecksPanelGitStatusContextKey({
        ...base,
        pushTarget: { remoteName: 'origin', branchName: 'feature/checks' }
      })
    ).not.toBe(
      buildChecksPanelGitStatusContextKey({
        ...base,
        pushTarget: { remoteName: 'fork', branchName: 'feature/checks' }
      })
    )
  })

  it('distinguishes every explicit target field including absent versus false', () => {
    const base = {
      repoId: 'repo-1',
      worktreeId: 'worktree-1',
      worktreePath: 'repo-worktree',
      branch: 'feature/checks',
      runtimeEnvironmentId: null,
      repoConnectionId: null
    }
    const context = (
      pushTarget: NonNullable<
        Parameters<typeof buildChecksPanelGitStatusContextKey>[0]['pushTarget']
      >
    ) => buildChecksPanelGitStatusContextKey({ ...base, pushTarget })
    const target = { remoteName: 'origin', branchName: 'feature/checks' }

    expect(context(target)).not.toBe(context({ ...target, remoteCreated: false }))
    expect(context(target)).not.toBe(context({ ...target, remoteUrl: 'ssh://git.example/repo' }))
  })

  it('changes when linked hosted review metadata changes', () => {
    const base = {
      repoId: 'repo-1',
      worktreeId: 'worktree-1',
      worktreePath: 'repo-worktree',
      branch: 'feature/checks',
      runtimeEnvironmentId: 'runtime-1',
      repoConnectionId: 'ssh-1',
      pushTarget: null
    }
    const unlinkedContext = buildChecksPanelGitStatusContextKey({
      ...base,
      linkedGitHubPR: null,
      linkedGitLabMR: null,
      linkedBitbucketPR: null,
      linkedAzureDevOpsPR: null,
      linkedGiteaPR: null
    })

    expect(
      buildChecksPanelGitStatusContextKey({
        ...base,
        linkedGitHubPR: 12,
        linkedGitLabMR: null,
        linkedBitbucketPR: null,
        linkedAzureDevOpsPR: null,
        linkedGiteaPR: null
      })
    ).not.toBe(unlinkedContext)
    expect(
      buildChecksPanelGitStatusContextKey({
        ...base,
        linkedGitHubPR: null,
        linkedGitLabMR: null,
        linkedBitbucketPR: 34,
        linkedAzureDevOpsPR: null,
        linkedGiteaPR: null
      })
    ).not.toBe(unlinkedContext)
    expect(
      buildChecksPanelGitStatusContextKey({
        ...base,
        linkedGitHubPR: null,
        linkedGitLabMR: null,
        linkedBitbucketPR: null,
        linkedAzureDevOpsPR: 56,
        linkedGiteaPR: null
      })
    ).not.toBe(unlinkedContext)
    expect(
      buildChecksPanelGitStatusContextKey({
        ...base,
        linkedGitHubPR: null,
        linkedGitLabMR: null,
        linkedBitbucketPR: null,
        linkedAzureDevOpsPR: null,
        linkedGiteaPR: 78
      })
    ).not.toBe(unlinkedContext)
  })
})

describe('readChecksPanelRepositorySnapshot', () => {
  it('projects a complete current-generation host snapshot without mutating it', () => {
    const snapshot = repositorySnapshot()

    expect(readChecksPanelRepositorySnapshot(snapshot, 'panel-context', 'feature/checks')).toEqual({
      contextKey: 'panel-context',
      hasUncommittedChanges: true,
      remoteStatus: snapshot.upstream,
      gitIdentity: { head: 'abc123', branch: 'feature/checks' }
    })
    expect(snapshot.status.entries).toHaveLength(1)
  })

  it.each(['missing', 'stale', 'failed'] as const)('rejects a %s status projection', (state) => {
    const snapshot = repositorySnapshot({
      freshness: {
        ...repositorySnapshot().freshness,
        status: { ...repositorySnapshot().freshness.status, state }
      }
    })

    expect(
      readChecksPanelRepositorySnapshot(snapshot, 'panel-context', 'feature/checks')
    ).toBeNull()
  })

  it.each(['missing', 'stale', 'failed'] as const)('rejects a %s upstream projection', (state) => {
    expect(
      readChecksPanelRepositorySnapshot(
        repositorySnapshot({
          freshness: {
            ...repositorySnapshot().freshness,
            upstream: { ...repositorySnapshot().freshness.upstream, state }
          }
        }),
        'panel-context',
        'feature/checks'
      )
    ).toBeNull()
  })

  it('rejects missing upstream data and retention-truncated status projections', () => {
    expect(
      readChecksPanelRepositorySnapshot(
        repositorySnapshot({
          upstream: null
        }),
        'panel-context',
        'feature/checks'
      )
    ).toBeNull()
    expect(
      readChecksPanelRepositorySnapshot(
        repositorySnapshot({
          status: { ...repositorySnapshot().status, retentionTruncated: true }
        }),
        'panel-context',
        'feature/checks'
      )
    ).toBeNull()
  })

  it('rejects an ambiguous embedded upstream projection', () => {
    expect(
      readChecksPanelRepositorySnapshot(
        repositorySnapshot({
          upstream: {
            hasUpstream: true,
            upstreamName: 'origin/main',
            ahead: 1,
            behind: 1
          }
        }),
        'panel-context',
        'feature/checks'
      )
    ).toBeNull()
  })

  it('rejects a fresh projection from another branch', () => {
    expect(
      readChecksPanelRepositorySnapshot(repositorySnapshot(), 'panel-context', 'feature/other')
    ).toBeNull()
  })
})

describe('readChecksPanelGitStatusSnapshot', () => {
  it('returns status inputs for the matching panel context', () => {
    expect(readChecksPanelGitStatusSnapshot(SNAPSHOT, SNAPSHOT.contextKey)).toEqual({
      hasUncommittedChanges: true,
      remoteStatus: {
        hasUpstream: false,
        ahead: 0,
        behind: 0
      }
    })
  })

  it('withholds worktree-keyed status after a runtime or SSH context change', () => {
    expect(
      readChecksPanelGitStatusSnapshot(SNAPSHOT, 'runtime:env-2::repo::worktree::branch')
    ).toEqual({
      hasUncommittedChanges: undefined,
      remoteStatus: undefined
    })
  })
})

describe('readChecksPanelPublishActionGitStatus', () => {
  it('uses the matching panel snapshot before worktree-keyed fallback status', () => {
    expect(
      readChecksPanelPublishActionGitStatus({
        snapshot: SNAPSHOT,
        contextKey: SNAPSHOT.contextKey,
        fallbackEntries: [],
        fallbackRemoteStatus: {
          hasUpstream: true,
          ahead: 0,
          behind: 0
        }
      })
    ).toEqual({
      hasUncommittedChanges: true,
      remoteStatus: {
        hasUpstream: false,
        ahead: 0,
        behind: 0
      }
    })
  })

  it('falls back to active worktree status when the panel snapshot is unavailable', () => {
    expect(
      readChecksPanelPublishActionGitStatus({
        snapshot: null,
        contextKey: SNAPSHOT.contextKey,
        fallbackEntries: [],
        fallbackRemoteStatus: {
          hasUpstream: false,
          ahead: 0,
          behind: 0
        }
      })
    ).toEqual({
      hasUncommittedChanges: false,
      remoteStatus: {
        hasUpstream: false,
        ahead: 0,
        behind: 0
      }
    })
  })

  it('does not synthesize publish inputs without fallback upstream status', () => {
    expect(
      readChecksPanelPublishActionGitStatus({
        snapshot: null,
        contextKey: SNAPSHOT.contextKey,
        fallbackEntries: [],
        fallbackRemoteStatus: undefined
      })
    ).toEqual({
      hasUncommittedChanges: undefined,
      remoteStatus: undefined
    })
  })
})

describe('readChecksPanelRefreshGitIdentitySnapshot', () => {
  it('treats refs/heads display differences as the same branch identity', () => {
    expect(
      readChecksPanelRefreshGitIdentitySnapshot({
        snapshot: SNAPSHOT,
        contextKey: SNAPSHOT.contextKey,
        currentBranch: 'feature/checks'
      })
    ).toEqual({ kind: 'same' })
  })

  it('reports missing when the snapshot is from a different execution context', () => {
    expect(
      readChecksPanelRefreshGitIdentitySnapshot({
        snapshot: SNAPSHOT,
        contextKey: 'runtime:env-2::repo::worktree::branch',
        currentBranch: 'feature/checks'
      })
    ).toEqual({ kind: 'missing' })
  })

  it('reports changed when the observed branch is a different branch', () => {
    expect(
      readChecksPanelRefreshGitIdentitySnapshot({
        snapshot: {
          ...SNAPSHOT,
          gitIdentity: {
            head: 'def456',
            branch: 'refs/heads/feature/next'
          }
        },
        contextKey: SNAPSHOT.contextKey,
        currentBranch: 'feature/checks'
      })
    ).toEqual({
      kind: 'changed',
      head: 'def456',
      branch: 'refs/heads/feature/next'
    })
  })

  it('reports missing when the snapshot lacks branch/head identity', () => {
    expect(
      readChecksPanelRefreshGitIdentitySnapshot({
        snapshot: {
          contextKey: SNAPSHOT.contextKey,
          hasUncommittedChanges: false,
          remoteStatus: undefined
        },
        contextKey: SNAPSHOT.contextKey,
        currentBranch: 'feature/checks'
      })
    ).toEqual({ kind: 'missing' })
  })
})

describe('hasChecksPanelGitStatusBranchChanged', () => {
  it('does not treat refs/heads display differences as branch changes', () => {
    expect(
      hasChecksPanelGitStatusBranchChanged({
        observedBranch: 'refs/heads/feature/checks',
        currentBranch: 'feature/checks'
      })
    ).toBe(false)
  })

  it('treats detached HEAD as changed from the rendered branch', () => {
    expect(
      hasChecksPanelGitStatusBranchChanged({
        observedBranch: null,
        currentBranch: 'feature/checks'
      })
    ).toBe(true)
  })
})

describe('shouldCommitChecksPanelGitStatusSnapshot', () => {
  it('suppresses stale status refresh completions from an older execution boundary', () => {
    expect(
      shouldCommitChecksPanelGitStatusSnapshot(
        'runtime:env-2::repo::worktree::branch',
        'runtime:env-1::repo::worktree::branch'
      )
    ).toBe(false)
  })
})

describe('shouldCoalesceChecksPanelGitStatusSnapshotRefresh', () => {
  it('coalesces only requests for the same panel context', () => {
    expect(
      shouldCoalesceChecksPanelGitStatusSnapshotRefresh(
        'runtime:env-1::repo::worktree::branch',
        'runtime:env-1::repo::worktree::branch'
      )
    ).toBe(true)
    expect(
      shouldCoalesceChecksPanelGitStatusSnapshotRefresh(
        'runtime:env-1::repo::worktree::branch',
        'runtime:env-2::repo::worktree::branch'
      )
    ).toBe(false)
  })
})

describe('shouldClearChecksPanelGitStatusSnapshot', () => {
  it('keeps the current snapshot while a same-context refresh is in flight', () => {
    expect(shouldClearChecksPanelGitStatusSnapshot(SNAPSHOT, SNAPSHOT.contextKey)).toBe(false)
  })

  it('clears snapshots from another execution boundary', () => {
    expect(
      shouldClearChecksPanelGitStatusSnapshot(SNAPSHOT, 'runtime:env-2::repo::worktree::branch')
    ).toBe(true)
  })
})

describe('shouldPollChecksPanelRuntimeSshStatus', () => {
  it('polls while a runtime environment is driving an SSH-backed repo', () => {
    expect(
      shouldPollChecksPanelRuntimeSshStatus({
        isPanelVisible: true,
        runtimeEnvironmentId: 'runtime-1',
        repoConnectionId: 'ssh-1'
      })
    ).toBe(true)
  })

  it('does not poll when the Checks panel is hidden or execution is not runtime-routed SSH', () => {
    expect(
      shouldPollChecksPanelRuntimeSshStatus({
        isPanelVisible: false,
        runtimeEnvironmentId: 'runtime-1',
        repoConnectionId: 'ssh-1'
      })
    ).toBe(false)
    expect(
      shouldPollChecksPanelRuntimeSshStatus({
        isPanelVisible: true,
        runtimeEnvironmentId: null,
        repoConnectionId: 'ssh-1'
      })
    ).toBe(false)
    expect(
      shouldPollChecksPanelRuntimeSshStatus({
        isPanelVisible: true,
        runtimeEnvironmentId: 'runtime-1',
        repoConnectionId: null
      })
    ).toBe(false)
  })
})
