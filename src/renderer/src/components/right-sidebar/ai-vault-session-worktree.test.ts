import { describe, expect, it } from 'vitest'
import type { AiVaultSession } from '../../../../shared/ai-vault-types'
import type { Repo, Worktree } from '../../../../shared/types'
import {
  aiVaultWorktreeCompactPath,
  aiVaultWorktreeJumpTooltip,
  canJumpToAiVaultSessionWorktree,
  isAiVaultSessionInCurrentWorktree,
  extractWorktreePathFromSessionTitle,
  resolveAiVaultSessionWorktreeDisplay,
  resolveAiVaultSessionWorktreeInfo,
  shouldShowAiVaultWorktreeStatusBadge,
  shouldShowAiVaultSessionWorktreeLine,
  type AiVaultSessionWorktreeInfo
} from './ai-vault-session-worktree'

const baseSession: AiVaultSession = {
  id: 'codex:session-1',
  executionHostId: 'local',
  agent: 'codex',
  sessionId: 'session-1',
  title: 'Find the pane',
  cwd: '/repo/orca/src',
  branch: null,
  model: null,
  filePath: '/home/ada/.codex/session-1.jsonl',
  codexHome: null,
  createdAt: null,
  updatedAt: '2026-06-24T10:00:00.000Z',
  modifiedAt: '2026-06-24T10:00:00.000Z',
  messageCount: 2,
  totalTokens: 42,
  previewMessages: [],
  queuedMessageCount: 0,
  subagentTranscriptCount: 0,
  resumeCommand: "codex resume 'session-1'",
  subagent: null
}

function makeWorktree(overrides: Partial<Worktree> = {}): Worktree {
  const worktree: Worktree = {
    id: 'repo-1::/repo/orca',
    repoId: 'repo-1',
    displayName: 'orca',
    path: '/repo/orca',
    head: 'abc123',
    branch: 'main',
    isBare: false,
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 1,
    isMainWorktree: false
  }
  return { ...worktree, ...overrides }
}

function makeRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    id: 'repo-1',
    path: '/repo/orca',
    displayName: 'orca',
    badgeColor: '#737373',
    addedAt: 1,
    connectionId: null,
    executionHostId: 'local',
    ...overrides
  }
}

describe('resolveAiVaultSessionWorktreeInfo', () => {
  it('marks the selected owning worktree as current', () => {
    const worktree = makeWorktree()

    expect(
      resolveAiVaultSessionWorktreeInfo({
        session: baseSession,
        worktrees: [worktree],
        activeWorktreeId: worktree.id
      })
    ).toMatchObject({
      status: 'current',
      label: 'orca',
      path: '/repo/orca'
    })
  })

  it('marks a known non-selected worktree as active', () => {
    const worktree = makeWorktree()

    expect(
      resolveAiVaultSessionWorktreeInfo({
        session: baseSession,
        worktrees: [worktree],
        activeWorktreeId: 'other'
      })?.status
    ).toBe('active')
  })

  it('uses prior worktree paths to identify renamed active worktrees', () => {
    const worktree = makeWorktree({
      id: 'repo-1::/repo/orca-renamed',
      path: '/repo/orca-renamed',
      priorWorktreeIds: ['repo-1::/repo/orca']
    })

    expect(
      resolveAiVaultSessionWorktreeInfo({
        session: baseSession,
        worktrees: [worktree],
        activeWorktreeId: null
      })
    ).toMatchObject({
      status: 'active',
      label: 'orca',
      path: '/repo/orca'
    })
  })

  it('falls back to unavailable when no known worktree owns the transcript cwd', () => {
    expect(
      resolveAiVaultSessionWorktreeInfo({
        session: baseSession,
        worktrees: [],
        activeWorktreeId: null
      })
    ).toMatchObject({
      status: 'unavailable',
      label: 'orca/src',
      path: '/repo/orca/src'
    })
  })

  it('matches WSL UNC worktree paths to Linux transcript cwd values', () => {
    const worktree = makeWorktree({
      path: '\\\\wsl.localhost\\Ubuntu\\home\\ada\\orca'
    })

    expect(
      resolveAiVaultSessionWorktreeInfo({
        session: { ...baseSession, cwd: '/home/ada/orca/src' },
        worktrees: [worktree],
        activeWorktreeId: null
      })
    ).toMatchObject({
      status: 'active',
      label: 'orca',
      path: '\\\\wsl.localhost\\Ubuntu\\home\\ada\\orca'
    })
  })

  it('uses the session host when multiple worktrees share the same path', () => {
    const localWorktree = makeWorktree({
      id: 'repo-local::/srv/orca',
      repoId: 'repo-local',
      displayName: 'local',
      path: '/srv/orca',
      hostId: 'local'
    })
    const sshWorktree = makeWorktree({
      id: 'repo-ssh::/srv/orca',
      repoId: 'repo-ssh',
      displayName: 'ssh',
      path: '/srv/orca',
      hostId: 'ssh:target-1'
    })

    expect(
      resolveAiVaultSessionWorktreeInfo({
        session: { ...baseSession, cwd: '/srv/orca/src', executionHostId: 'ssh:target-1' },
        worktrees: [localWorktree, sshWorktree],
        activeWorktreeId: null
      })
    ).toMatchObject({
      label: 'ssh',
      worktreeId: sshWorktree.id
    })
  })

  it('uses repo host ownership when a legacy worktree lacks host metadata', () => {
    const worktree = makeWorktree({
      id: 'repo-ssh::/srv/orca',
      repoId: 'repo-ssh',
      displayName: 'ssh',
      path: '/srv/orca'
    })

    expect(
      resolveAiVaultSessionWorktreeInfo({
        session: { ...baseSession, cwd: '/srv/orca/src', executionHostId: 'ssh:target-1' },
        repos: [makeRepo({ id: 'repo-ssh', connectionId: 'target-1', executionHostId: null })],
        worktrees: [worktree],
        activeWorktreeId: null
      })
    ).toMatchObject({
      label: 'ssh',
      worktreeId: worktree.id
    })
  })

  it('matches an NFD workspace path to an NFC transcript cwd', () => {
    // macOS yields NFD on disk while Claude Code records cwd in NFC (#10832).
    // The projection precomputes its matchers, so the fold has to survive that.
    const nfcPath = '/repo/프로젝트'
    const worktree = makeWorktree({
      id: `repo-1::${nfcPath.normalize('NFD')}`,
      displayName: '',
      path: nfcPath.normalize('NFD')
    })

    expect(
      resolveAiVaultSessionWorktreeInfo({
        session: { ...baseSession, cwd: `${nfcPath}/src` },
        worktrees: [worktree],
        activeWorktreeId: null
      })
    ).toMatchObject({
      status: 'active',
      worktreeId: worktree.id
    })
  })

  it('matches an NFD transcript cwd to an NFC workspace path', () => {
    const nfcPath = '/repo/café'
    const worktree = makeWorktree({
      id: `repo-1::${nfcPath}`,
      displayName: '',
      path: nfcPath
    })

    expect(
      resolveAiVaultSessionWorktreeInfo({
        session: { ...baseSession, cwd: `${nfcPath}/src`.normalize('NFD') },
        worktrees: [worktree],
        activeWorktreeId: null
      })
    ).toMatchObject({
      status: 'active',
      worktreeId: worktree.id
    })
  })

  it('does not treat a sibling sharing a path prefix as the owner', () => {
    // Guards the candidate matcher's boundary: '/repo/orca-sibling' must not
    // match under '/repo/orca'.
    const worktree = makeWorktree()
    const sibling = makeWorktree({
      id: 'repo-1::/repo/orca-sibling',
      displayName: 'sibling',
      path: '/repo/orca-sibling'
    })

    expect(
      resolveAiVaultSessionWorktreeInfo({
        session: { ...baseSession, cwd: '/repo/orca-sibling/src' },
        worktrees: [worktree, sibling],
        activeWorktreeId: null
      })
    ).toMatchObject({ worktreeId: sibling.id })
  })

  it('prefers the deepest owning worktree when workspaces nest', () => {
    // The single-pass max must reproduce the old sort: longest comparison path
    // wins, and 'current-path' breaks a tie against 'prior-path'.
    const outer = makeWorktree({
      id: 'repo-1::/repo/orca',
      displayName: 'outer',
      path: '/repo/orca'
    })
    const inner = makeWorktree({
      id: 'repo-1::/repo/orca/packages/app',
      displayName: 'inner',
      path: '/repo/orca/packages/app'
    })

    expect(
      resolveAiVaultSessionWorktreeInfo({
        session: { ...baseSession, cwd: '/repo/orca/packages/app/src' },
        worktrees: [outer, inner],
        activeWorktreeId: null
      })
    ).toMatchObject({ worktreeId: inner.id })
  })

  it('prefers a current path over another worktree holding it as a prior path', () => {
    const current = makeWorktree({
      id: 'repo-1::/repo/orca',
      displayName: 'current',
      path: '/repo/orca'
    })
    const renamed = makeWorktree({
      id: 'repo-1::/repo/orca-renamed',
      displayName: 'renamed',
      path: '/repo/orca-renamed',
      priorWorktreeIds: ['repo-1::/repo/orca']
    })

    expect(
      resolveAiVaultSessionWorktreeInfo({
        session: baseSession,
        worktrees: [renamed, current],
        activeWorktreeId: null
      })
    ).toMatchObject({ worktreeId: current.id })
  })

  it('resolves a large workspace set without rebuilding candidates per session', () => {
    // Regression for the ~1s workspace-switch stall (#10841): resolving each
    // session used to rebuild and re-normalize every candidate, making the
    // panel O(sessions x worktrees) on path normalization. Times a fan-out
    // rather than counting calls so it fails on any return to that shape.
    const worktrees = Array.from({ length: 1200 }, (_, i) =>
      makeWorktree({
        id: `repo-1::/repo/w${i}`,
        displayName: `w${i}`,
        path: `/repo/w${i}`
      })
    )
    const sessions = Array.from({ length: 400 }, (_, i) => ({
      ...baseSession,
      id: `codex:session-${i}`,
      cwd: `/repo/w${i % worktrees.length}/src`
    }))

    const startedAt = performance.now()
    const resolved = sessions.map((session) =>
      resolveAiVaultSessionWorktreeInfo({ session, worktrees, activeWorktreeId: null })
    )
    const elapsedMs = performance.now() - startedAt

    expect(resolved.every((info) => info?.status === 'active')).toBe(true)
    // Was ~350ms+ before the fix and ~10ms after; the bound is loose enough to
    // stay quiet on a slow CI box while still catching the quadratic shape.
    expect(elapsedMs).toBeLessThan(150)
  })
})

describe('canJumpToAiVaultSessionWorktree', () => {
  it('allows current and active worktree targets', () => {
    expect(canJumpToAiVaultSessionWorktree(makeWorktreeInfo('current'))).toBe(true)
    expect(canJumpToAiVaultSessionWorktree(makeWorktreeInfo('active'))).toBe(true)
  })

  it('disables jump targets that are not active worktrees', () => {
    expect(canJumpToAiVaultSessionWorktree(makeWorktreeInfo('archived'))).toBe(false)
    expect(canJumpToAiVaultSessionWorktree(makeWorktreeInfo('unavailable'))).toBe(false)
    expect(canJumpToAiVaultSessionWorktree(null)).toBe(false)
  })
})

describe('isAiVaultSessionInCurrentWorktree', () => {
  it('flags only the worktree the user is already viewing', () => {
    expect(isAiVaultSessionInCurrentWorktree(makeWorktreeInfo('current'))).toBe(true)
    expect(isAiVaultSessionInCurrentWorktree(makeWorktreeInfo('active'))).toBe(false)
    expect(isAiVaultSessionInCurrentWorktree(makeWorktreeInfo('archived'))).toBe(false)
    expect(isAiVaultSessionInCurrentWorktree(makeWorktreeInfo('unavailable'))).toBe(false)
    expect(isAiVaultSessionInCurrentWorktree(null)).toBe(false)
  })
})

describe('extractWorktreePathFromSessionTitle', () => {
  it('reads worktree paths embedded in session titles', () => {
    expect(
      extractWorktreePathFromSessionTitle(
        'Inspect PR #6229 - Worktree: /Users/ada/projects/orca/fix-tabs'
      )
    ).toBe('/Users/ada/projects/orca/fix-tabs')
    expect(extractWorktreePathFromSessionTitle('Worktree: /tmp/orca-worker')).toBe(
      '/tmp/orca-worker'
    )
  })
})

describe('resolveAiVaultSessionWorktreeDisplay', () => {
  it('falls back to title and branch when cwd is missing', () => {
    expect(
      resolveAiVaultSessionWorktreeDisplay({
        session: {
          ...baseSession,
          cwd: null,
          branch: null,
          title: 'Fix tabs - Worktree: /Users/ada/projects/orca/fix-tabs'
        },
        worktrees: [makeWorktree()],
        activeWorktreeId: null
      })?.path
    ).toBe('/Users/ada/projects/orca/fix-tabs')

    expect(
      resolveAiVaultSessionWorktreeDisplay({
        session: { ...baseSession, cwd: null, branch: 'chinese-translation-improvement' },
        worktrees: [makeWorktree()],
        activeWorktreeId: null
      })?.label
    ).toBe('chinese-translation-improvement')
  })
})

describe('aiVaultWorktreeCompactPath', () => {
  it('keeps the last two path segments for dense detail rows', () => {
    expect(aiVaultWorktreeCompactPath('/Users/ada/projects/orca/improve-agent-session')).toBe(
      'orca/improve-agent-session'
    )
  })
})

describe('shouldShowAiVaultSessionWorktreeLine', () => {
  it('hides the worktree row for the current worktree in workspace scope', () => {
    expect(
      shouldShowAiVaultSessionWorktreeLine(makeWorktreeInfo('current'), { vaultScope: 'workspace' })
    ).toBe(false)
    expect(
      shouldShowAiVaultSessionWorktreeLine(makeWorktreeInfo('current'), { vaultScope: 'all' })
    ).toBe(true)
    expect(
      shouldShowAiVaultSessionWorktreeLine(makeWorktreeInfo('active'), { vaultScope: 'workspace' })
    ).toBe(true)
    expect(shouldShowAiVaultSessionWorktreeLine(null, { vaultScope: 'workspace' })).toBe(false)
  })
})

describe('shouldShowAiVaultWorktreeStatusBadge', () => {
  it('hides the generic active badge but keeps meaningful states', () => {
    expect(shouldShowAiVaultWorktreeStatusBadge('active')).toBe(false)
    expect(shouldShowAiVaultWorktreeStatusBadge('current')).toBe(true)
    expect(shouldShowAiVaultWorktreeStatusBadge('archived')).toBe(true)
    expect(shouldShowAiVaultWorktreeStatusBadge('unavailable')).toBe(true)
  })

  it('hides the current badge in workspace scope', () => {
    expect(shouldShowAiVaultWorktreeStatusBadge('current', { vaultScope: 'workspace' })).toBe(false)
    expect(shouldShowAiVaultWorktreeStatusBadge('current', { vaultScope: 'all' })).toBe(true)
    expect(shouldShowAiVaultWorktreeStatusBadge('archived', { vaultScope: 'workspace' })).toBe(true)
  })
})

describe('aiVaultWorktreeJumpTooltip', () => {
  it('explains active jump targets and disabled states', () => {
    expect(aiVaultWorktreeJumpTooltip(makeWorktreeInfo('active'))).toBe('Jump to Worktree')
    expect(aiVaultWorktreeJumpTooltip(makeWorktreeInfo('archived'))).toBe(
      'This session is in an archived worktree.'
    )
    expect(aiVaultWorktreeJumpTooltip(makeWorktreeInfo('unavailable'))).toBe(
      'No active worktree matches this session.'
    )
    expect(aiVaultWorktreeJumpTooltip(null)).toBe('No worktree was recorded for this session.')
  })
})

function makeWorktreeInfo(
  status: AiVaultSessionWorktreeInfo['status']
): AiVaultSessionWorktreeInfo {
  return {
    status,
    label: 'orca',
    path: '/repo/orca',
    ...(status === 'unavailable' ? {} : { worktreeId: 'repo-1::/repo/orca' })
  }
}
