import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  WorkspaceCleanupCandidate,
  WorkspaceCleanupScanResult
} from '../shared/workspace-cleanup'

const { userDataDirHolder } = vi.hoisted(() => ({ userDataDirHolder: { dir: '' } }))

vi.mock('./persistence', () => ({
  getCanonicalUserDataPath: () => userDataDirHolder.dir
}))

import {
  persistWorkspaceCleanupScanResult,
  pruneWorkspaceCleanupScanSnapshot,
  readWorkspaceCleanupScanSnapshot,
  workspaceCleanupScanSnapshotFingerprint
} from './workspace-cleanup-scan-snapshot'

const SNAPSHOT_FILE = 'orca-workspace-cleanup-scan.json'
const NOW = 1_700_000_000_000

function makeCandidate(
  overrides: Partial<WorkspaceCleanupCandidate> = {}
): WorkspaceCleanupCandidate {
  return {
    worktreeId: 'repo-1::/repo-feature',
    repoId: 'repo-1',
    repoName: 'Repo',
    connectionId: null,
    displayName: 'Feature',
    branch: 'feature',
    path: '/repo-feature',
    tier: 'ready',
    selectedByDefault: true,
    reasons: ['idle-clean'],
    blockers: [],
    lastActivityAt: NOW - 40 * 24 * 60 * 60 * 1000,
    localContext: {
      terminalTabCount: 0,
      cleanEditorTabCount: 0,
      browserTabCount: 0,
      diffCommentCount: 0,
      newestDiffCommentAt: null,
      retainedDoneAgentCount: 0
    },
    git: { clean: true, upstreamAhead: 0, upstreamBehind: 0, checkedAt: NOW },
    fingerprint: '2|feature|abc123|clean|19675',
    ...overrides
  }
}

function makeBroadResult(candidates: WorkspaceCleanupCandidate[]): WorkspaceCleanupScanResult {
  return { scannedAt: NOW, candidates, errors: [] }
}

describe('workspace cleanup scan snapshot', () => {
  beforeEach(async () => {
    userDataDirHolder.dir = await mkdtemp(join(tmpdir(), 'orca-cleanup-snapshot-'))
  })

  afterEach(async () => {
    await rm(userDataDirHolder.dir, { recursive: true, force: true })
  })

  it('round-trips a broad scan snapshot, including SSH connectionId rows', async () => {
    const sshCandidate = makeCandidate({
      worktreeId: 'repo-ssh::/remote/repo-feature',
      repoId: 'repo-ssh',
      connectionId: 'ssh-1',
      path: '/remote/repo-feature',
      blockers: ['ssh-disconnected'],
      git: { clean: null, upstreamAhead: null, upstreamBehind: null, checkedAt: null }
    })
    const result = makeBroadResult([makeCandidate(), sshCandidate])

    await persistWorkspaceCleanupScanResult({ includeAllWorkspaces: true }, result)

    await expect(readWorkspaceCleanupScanSnapshot()).resolves.toEqual(result)
  })

  it('returns null when no snapshot has been persisted', async () => {
    await expect(readWorkspaceCleanupScanSnapshot()).resolves.toBeNull()
  })

  it('degrades corrupt persisted blobs to null instead of throwing', async () => {
    const file = join(userDataDirHolder.dir, SNAPSHOT_FILE)

    await writeFile(file, 'not json{', 'utf-8')
    await expect(readWorkspaceCleanupScanSnapshot()).resolves.toBeNull()

    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        argsFingerprint: workspaceCleanupScanSnapshotFingerprint(),
        result: { scannedAt: NOW, candidates: 'nope', errors: [] }
      }),
      'utf-8'
    )
    await expect(readWorkspaceCleanupScanSnapshot()).resolves.toBeNull()

    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        argsFingerprint: workspaceCleanupScanSnapshotFingerprint(),
        result: { scannedAt: NOW, candidates: [{ worktreeId: 42 }], errors: [] }
      }),
      'utf-8'
    )
    await expect(readWorkspaceCleanupScanSnapshot()).resolves.toBeNull()
  })

  it('treats a snapshot from another classifier version as absent', async () => {
    await writeFile(
      join(userDataDirHolder.dir, SNAPSHOT_FILE),
      JSON.stringify({
        version: 1,
        argsFingerprint: 'classifier:1|includeAllWorkspaces',
        result: makeBroadResult([makeCandidate()])
      }),
      'utf-8'
    )

    await expect(readWorkspaceCleanupScanSnapshot()).resolves.toBeNull()
  })

  it('patches targeted rescans into the snapshot without touching other rows', async () => {
    const stale = makeCandidate({ git: { ...makeCandidate().git, clean: null, checkedAt: null } })
    const other = makeCandidate({
      worktreeId: 'repo-1::/repo-other',
      path: '/repo-other',
      branch: 'other'
    })
    await persistWorkspaceCleanupScanResult(
      { includeAllWorkspaces: true },
      makeBroadResult([stale, other])
    )

    const rescanned = makeCandidate({ tier: 'protected', blockers: ['dirty-files'] })
    await persistWorkspaceCleanupScanResult(
      { worktreeId: stale.worktreeId },
      { scannedAt: NOW + 60_000, candidates: [rescanned], errors: [] }
    )

    const snapshot = await readWorkspaceCleanupScanSnapshot()
    expect(snapshot?.candidates).toEqual([rescanned, other])
    // Snapshot freshness stays anchored to the last FULL scan.
    expect(snapshot?.scannedAt).toBe(NOW)
  })

  it('appends targeted rows the snapshot has not seen yet', async () => {
    await persistWorkspaceCleanupScanResult(
      { includeAllWorkspaces: true },
      makeBroadResult([makeCandidate()])
    )

    const created = makeCandidate({ worktreeId: 'repo-1::/repo-new', path: '/repo-new' })
    await persistWorkspaceCleanupScanResult(
      { worktreeId: created.worktreeId },
      { scannedAt: NOW + 1, candidates: [created], errors: [] }
    )

    const snapshot = await readWorkspaceCleanupScanSnapshot()
    expect(snapshot?.candidates.map((candidate) => candidate.worktreeId)).toEqual([
      'repo-1::/repo-feature',
      'repo-1::/repo-new'
    ])
  })

  it('does not create a snapshot from a targeted scan alone', async () => {
    await persistWorkspaceCleanupScanResult(
      { worktreeId: 'repo-1::/repo-feature' },
      makeBroadResult([makeCandidate()])
    )

    await expect(readWorkspaceCleanupScanSnapshot()).resolves.toBeNull()
    await expect(readFile(join(userDataDirHolder.dir, SNAPSHOT_FILE))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('keeps the broad snapshot when a legacy suggestion-only scan completes', async () => {
    const broad = makeBroadResult([
      makeCandidate(),
      makeCandidate({ worktreeId: 'repo-1::/b', path: '/b' })
    ])
    await persistWorkspaceCleanupScanResult({ includeAllWorkspaces: true }, broad)

    const legacyRow = makeCandidate({ tier: 'review', selectedByDefault: false })
    await persistWorkspaceCleanupScanResult(
      {},
      { scannedAt: NOW + 1, candidates: [legacyRow], errors: [] }
    )

    const snapshot = await readWorkspaceCleanupScanSnapshot()
    expect(snapshot?.candidates).toHaveLength(2)
    expect(snapshot?.candidates[0]).toEqual(legacyRow)
  })

  it('prunes a removed worktree so it cannot resurrect from cache', async () => {
    const kept = makeCandidate({ worktreeId: 'repo-1::/repo-kept', path: '/repo-kept' })
    await persistWorkspaceCleanupScanResult(
      { includeAllWorkspaces: true },
      makeBroadResult([makeCandidate(), kept])
    )

    await pruneWorkspaceCleanupScanSnapshot('repo-1::/repo-feature')

    const snapshot = await readWorkspaceCleanupScanSnapshot()
    expect(snapshot?.candidates).toEqual([kept])

    // Unknown ids are a no-op.
    await pruneWorkspaceCleanupScanSnapshot('repo-1::/never-existed')
    await expect(readWorkspaceCleanupScanSnapshot()).resolves.toEqual(snapshot)
  })
})
