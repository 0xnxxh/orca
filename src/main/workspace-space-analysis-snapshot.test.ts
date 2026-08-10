import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  WorkspaceSpaceAnalysis,
  WorkspaceSpaceWorktree
} from '../shared/workspace-space-types'

const { userDataDirHolder } = vi.hoisted(() => ({ userDataDirHolder: { dir: '' } }))

vi.mock('./persistence', () => ({
  getCanonicalUserDataPath: () => userDataDirHolder.dir
}))

import {
  persistWorkspaceSpaceAnalysisSnapshot,
  pruneWorkspaceSpaceAnalysisSnapshot,
  readWorkspaceSpaceAnalysisSnapshot
} from './workspace-space-analysis-snapshot'

const SNAPSHOT_FILE = 'orca-workspace-space-analysis.json'
const NOW = 1_700_000_000_000

function makeWorktreeRow(overrides: Partial<WorkspaceSpaceWorktree> = {}): WorkspaceSpaceWorktree {
  return {
    worktreeId: 'repo-1::/repo-feature',
    repoId: 'repo-1',
    repoDisplayName: 'Repo',
    repoPath: '/repo',
    displayName: 'Feature',
    path: '/repo-feature',
    branch: 'feature',
    isMainWorktree: false,
    isRemote: false,
    isSparse: false,
    canDelete: true,
    lastActivityAt: NOW - 1000,
    status: 'ok',
    error: null,
    scannedAt: NOW,
    sizeBytes: 1000,
    reclaimableBytes: 1000,
    skippedEntryCount: 0,
    topLevelItems: [],
    omittedTopLevelItemCount: 0,
    omittedTopLevelSizeBytes: 0,
    ...overrides
  }
}

function makeAnalysis(worktrees: WorkspaceSpaceWorktree[]): WorkspaceSpaceAnalysis {
  const okRows = worktrees.filter((row) => row.status === 'ok')
  return {
    scannedAt: NOW,
    totalSizeBytes: worktrees.reduce((sum, row) => sum + row.sizeBytes, 0),
    reclaimableBytes: worktrees.reduce((sum, row) => sum + row.reclaimableBytes, 0),
    worktreeCount: worktrees.length,
    scannedWorktreeCount: okRows.length,
    unavailableWorktreeCount: worktrees.length - okRows.length,
    repos: [
      {
        repoId: 'repo-1',
        displayName: 'Repo',
        path: '/repo',
        isRemote: false,
        worktreeCount: worktrees.length,
        scannedWorktreeCount: okRows.length,
        unavailableWorktreeCount: worktrees.length - okRows.length,
        totalSizeBytes: worktrees.reduce((sum, row) => sum + row.sizeBytes, 0),
        reclaimableBytes: worktrees.reduce((sum, row) => sum + row.reclaimableBytes, 0),
        error: null
      }
    ],
    worktrees
  }
}

describe('workspace space analysis snapshot', () => {
  beforeEach(async () => {
    userDataDirHolder.dir = await mkdtemp(join(tmpdir(), 'orca-space-snapshot-'))
  })

  afterEach(async () => {
    await rm(userDataDirHolder.dir, { recursive: true, force: true })
  })

  it('round-trips a completed analysis', async () => {
    const analysis = makeAnalysis([makeWorktreeRow()])

    await persistWorkspaceSpaceAnalysisSnapshot(analysis)

    await expect(readWorkspaceSpaceAnalysisSnapshot()).resolves.toEqual(analysis)
  })

  it('prunes topLevelItems into the omitted counters to bound the payload', async () => {
    const row = makeWorktreeRow({
      sizeBytes: 5000,
      topLevelItems: [
        {
          name: 'node_modules',
          path: '/repo-feature/node_modules',
          kind: 'directory',
          sizeBytes: 3000
        },
        { name: 'src', path: '/repo-feature/src', kind: 'directory', sizeBytes: 1000 }
      ],
      omittedTopLevelItemCount: 2,
      omittedTopLevelSizeBytes: 500
    })

    await persistWorkspaceSpaceAnalysisSnapshot(makeAnalysis([row]))

    const cached = await readWorkspaceSpaceAnalysisSnapshot()
    expect(cached?.worktrees[0]).toMatchObject({
      sizeBytes: 5000,
      topLevelItems: [],
      omittedTopLevelItemCount: 4,
      omittedTopLevelSizeBytes: 4500
    })
  })

  it('returns null when missing or corrupt instead of throwing', async () => {
    await expect(readWorkspaceSpaceAnalysisSnapshot()).resolves.toBeNull()

    const file = join(userDataDirHolder.dir, SNAPSHOT_FILE)
    await writeFile(file, '{"version":1,"analysis":', 'utf-8')
    await expect(readWorkspaceSpaceAnalysisSnapshot()).resolves.toBeNull()

    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        analysis: { scannedAt: 'yesterday', repos: [], worktrees: [] }
      }),
      'utf-8'
    )
    await expect(readWorkspaceSpaceAnalysisSnapshot()).resolves.toBeNull()

    await writeFile(
      file,
      JSON.stringify({ version: 99, analysis: makeAnalysis([makeWorktreeRow()]) }),
      'utf-8'
    )
    await expect(readWorkspaceSpaceAnalysisSnapshot()).resolves.toBeNull()
  })

  it('prunes a removed worktree row and rebalances totals', async () => {
    const removed = makeWorktreeRow({ sizeBytes: 3000, reclaimableBytes: 3000 })
    const kept = makeWorktreeRow({
      worktreeId: 'repo-1::/repo-kept',
      path: '/repo-kept',
      status: 'missing',
      sizeBytes: 1000,
      reclaimableBytes: 0
    })
    await persistWorkspaceSpaceAnalysisSnapshot(makeAnalysis([removed, kept]))

    await pruneWorkspaceSpaceAnalysisSnapshot(removed.worktreeId)

    const cached = await readWorkspaceSpaceAnalysisSnapshot()
    expect(cached?.worktrees.map((row) => row.worktreeId)).toEqual(['repo-1::/repo-kept'])
    expect(cached).toMatchObject({
      worktreeCount: 1,
      scannedWorktreeCount: 0,
      unavailableWorktreeCount: 1,
      totalSizeBytes: 1000,
      reclaimableBytes: 0
    })
    expect(cached?.repos[0]).toMatchObject({
      worktreeCount: 1,
      scannedWorktreeCount: 0,
      unavailableWorktreeCount: 1,
      totalSizeBytes: 1000,
      reclaimableBytes: 0
    })

    // Unknown ids are a no-op.
    await pruneWorkspaceSpaceAnalysisSnapshot('repo-1::/never-existed')
    await expect(readWorkspaceSpaceAnalysisSnapshot()).resolves.toEqual(cached)
  })
})
