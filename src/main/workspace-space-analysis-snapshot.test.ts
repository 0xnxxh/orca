import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  WorkspaceSpaceAnalysis,
  WorkspaceSpaceWorktree
} from '../shared/workspace-space-types'

const { userDataDirHolder } = vi.hoisted(() => ({ userDataDirHolder: { dir: '' } }))

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
    executionHostId: 'local',
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
  const rowsByHost = Map.groupBy(worktrees, (row) => row.executionHostId ?? 'local')
  return {
    scannedAt: NOW,
    totalSizeBytes: worktrees.reduce((sum, row) => sum + row.sizeBytes, 0),
    reclaimableBytes: worktrees.reduce((sum, row) => sum + row.reclaimableBytes, 0),
    worktreeCount: worktrees.length,
    scannedWorktreeCount: okRows.length,
    unavailableWorktreeCount: worktrees.length - okRows.length,
    repos: [...rowsByHost.entries()].map(([executionHostId, rows]) => {
      const scanned = rows.filter((row) => row.status === 'ok')
      return {
        repoId: 'repo-1',
        executionHostId,
        displayName: 'Repo',
        path: '/repo',
        isRemote: executionHostId !== 'local',
        worktreeCount: rows.length,
        scannedWorktreeCount: scanned.length,
        unavailableWorktreeCount: rows.length - scanned.length,
        totalSizeBytes: rows.reduce((sum, row) => sum + row.sizeBytes, 0),
        reclaimableBytes: rows.reduce((sum, row) => sum + row.reclaimableBytes, 0),
        error: null
      }
    }),
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

    await persistWorkspaceSpaceAnalysisSnapshot(userDataDirHolder.dir, analysis)

    await expect(readWorkspaceSpaceAnalysisSnapshot(userDataDirHolder.dir)).resolves.toEqual(
      analysis
    )
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

    await persistWorkspaceSpaceAnalysisSnapshot(userDataDirHolder.dir, makeAnalysis([row]))

    const cached = await readWorkspaceSpaceAnalysisSnapshot(userDataDirHolder.dir)
    expect(cached?.worktrees[0]).toMatchObject({
      sizeBytes: 5000,
      topLevelItems: [],
      omittedTopLevelItemCount: 4,
      omittedTopLevelSizeBytes: 4500
    })
  })

  it('returns null when missing or corrupt instead of throwing', async () => {
    await expect(readWorkspaceSpaceAnalysisSnapshot(userDataDirHolder.dir)).resolves.toBeNull()

    const file = join(userDataDirHolder.dir, SNAPSHOT_FILE)
    await writeFile(file, '{"version":1,"analysis":', 'utf-8')
    await expect(readWorkspaceSpaceAnalysisSnapshot(userDataDirHolder.dir)).resolves.toBeNull()

    await writeFile(
      file,
      JSON.stringify({
        version: 2,
        analysis: { scannedAt: 'yesterday', repos: [], worktrees: [] }
      }),
      'utf-8'
    )
    await expect(readWorkspaceSpaceAnalysisSnapshot(userDataDirHolder.dir)).resolves.toBeNull()

    await writeFile(
      file,
      JSON.stringify({ version: 99, analysis: makeAnalysis([makeWorktreeRow()]) }),
      'utf-8'
    )
    await expect(readWorkspaceSpaceAnalysisSnapshot(userDataDirHolder.dir)).resolves.toBeNull()
  })

  it('loads legacy rows without an execution host id', async () => {
    const { executionHostId: _executionHostId, ...legacyRow } = makeWorktreeRow()
    const analysis = makeAnalysis([makeWorktreeRow()])
    await writeFile(
      join(userDataDirHolder.dir, SNAPSHOT_FILE),
      JSON.stringify({
        version: 2,
        analysis: { ...analysis, worktrees: [legacyRow] }
      }),
      'utf-8'
    )

    await expect(readWorkspaceSpaceAnalysisSnapshot(userDataDirHolder.dir)).resolves.toMatchObject({
      worktrees: [expect.objectContaining({ worktreeId: legacyRow.worktreeId })]
    })
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
    await persistWorkspaceSpaceAnalysisSnapshot(
      userDataDirHolder.dir,
      makeAnalysis([removed, kept])
    )

    await pruneWorkspaceSpaceAnalysisSnapshot(userDataDirHolder.dir, removed.worktreeId, 'local')

    const cached = await readWorkspaceSpaceAnalysisSnapshot(userDataDirHolder.dir)
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
    await pruneWorkspaceSpaceAnalysisSnapshot(userDataDirHolder.dir, 'repo-1::/never-existed')
    await expect(readWorkspaceSpaceAnalysisSnapshot(userDataDirHolder.dir)).resolves.toEqual(cached)
  })

  it('keeps profile snapshots isolated', async () => {
    const otherProfile = await mkdtemp(join(tmpdir(), 'orca-space-snapshot-other-'))
    try {
      await persistWorkspaceSpaceAnalysisSnapshot(
        userDataDirHolder.dir,
        makeAnalysis([makeWorktreeRow()])
      )

      await expect(readWorkspaceSpaceAnalysisSnapshot(otherProfile)).resolves.toBeNull()
    } finally {
      await rm(otherProfile, { recursive: true, force: true })
    }
  })

  it('does not let an analysis started before removal restore the pruned row', async () => {
    const staleAnalysis = {
      ...makeAnalysis([makeWorktreeRow()]),
      scannedAt: Date.now() - 1
    }
    await pruneWorkspaceSpaceAnalysisSnapshot(
      userDataDirHolder.dir,
      'repo-1::/repo-feature',
      'local'
    )

    await persistWorkspaceSpaceAnalysisSnapshot(userDataDirHolder.dir, staleAnalysis)
    expect((await readWorkspaceSpaceAnalysisSnapshot(userDataDirHolder.dir))?.worktrees).toEqual([])

    const recreated = { ...staleAnalysis, scannedAt: Date.now() + 1 }
    await persistWorkspaceSpaceAnalysisSnapshot(userDataDirHolder.dir, recreated)
    expect((await readWorkspaceSpaceAnalysisSnapshot(userDataDirHolder.dir))?.worktrees).toEqual([
      makeWorktreeRow()
    ])
  })

  it('prunes host-colliding workspace ids without corrupting surviving totals', async () => {
    const local = makeWorktreeRow({ sizeBytes: 1000, reclaimableBytes: 1000 })
    const remote = makeWorktreeRow({
      executionHostId: 'ssh:ssh-1',
      isRemote: true,
      sizeBytes: 3000,
      reclaimableBytes: 3000
    })
    await persistWorkspaceSpaceAnalysisSnapshot(
      userDataDirHolder.dir,
      makeAnalysis([local, remote])
    )

    await pruneWorkspaceSpaceAnalysisSnapshot(userDataDirHolder.dir, remote.worktreeId, 'ssh:ssh-1')

    const cached = await readWorkspaceSpaceAnalysisSnapshot(userDataDirHolder.dir)
    expect(cached?.worktrees).toEqual([local])
    expect(cached).toMatchObject({
      worktreeCount: 1,
      scannedWorktreeCount: 1,
      totalSizeBytes: 1000,
      reclaimableBytes: 1000
    })
    expect(cached?.repos).toEqual([
      expect.objectContaining({
        executionHostId: 'local',
        worktreeCount: 1,
        totalSizeBytes: 1000
      }),
      expect.objectContaining({
        executionHostId: 'ssh:ssh-1',
        worktreeCount: 0,
        totalSizeBytes: 0
      })
    ])
  })

  it('prunes every host-colliding row when the host is unknown', async () => {
    const local = makeWorktreeRow({ sizeBytes: 1000, reclaimableBytes: 1000 })
    const remote = makeWorktreeRow({
      executionHostId: 'ssh:ssh-1',
      isRemote: true,
      sizeBytes: 3000,
      reclaimableBytes: 3000
    })
    await persistWorkspaceSpaceAnalysisSnapshot(
      userDataDirHolder.dir,
      makeAnalysis([local, remote])
    )

    await pruneWorkspaceSpaceAnalysisSnapshot(userDataDirHolder.dir, local.worktreeId)

    const cached = await readWorkspaceSpaceAnalysisSnapshot(userDataDirHolder.dir)
    expect(cached?.worktrees).toEqual([])
    expect(cached).toMatchObject({
      worktreeCount: 0,
      scannedWorktreeCount: 0,
      totalSizeBytes: 0,
      reclaimableBytes: 0
    })
  })
})
