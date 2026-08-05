import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { createIsolatedStagedLocaleDiffRepo } from './large-diff-repro-fixtures'

async function addAndActivateRepo(orcaPage: Page, repoPath: string): Promise<string> {
  const repoId = await orcaPage.evaluate(async (pathToRepo: string) => {
    const store = window.__store
    if (!store) {
      throw new Error('window.__store is not available')
    }
    const addedRepo = await store.getState().addRepoPath(pathToRepo)
    if (!addedRepo) {
      throw new Error(`isolated repo not found: ${pathToRepo}`)
    }
    return addedRepo.id
  }, repoPath)

  await expect
    .poll(
      () =>
        orcaPage.evaluate(async (targetRepoId: string) => {
          const store = window.__store
          if (!store) {
            return 0
          }
          await store.getState().fetchWorktrees(targetRepoId)
          return store.getState().worktreesByRepo[targetRepoId]?.length ?? 0
        }, repoId),
      { timeout: 30_000, message: 'isolated staged-diff worktree did not load' }
    )
    .toBeGreaterThan(0)

  return orcaPage.evaluate(
    ({ targetRepoId, pathToRepo }) => {
      const store = window.__store
      if (!store) {
        throw new Error('window.__store is not available')
      }
      const state = store.getState()
      const worktrees = state.worktreesByRepo[targetRepoId] ?? []
      const worktree = worktrees.find((entry) => entry.path === pathToRepo) ?? worktrees[0]
      if (!worktree) {
        throw new Error(`isolated worktree not found: ${pathToRepo}`)
      }
      state.setActiveRepo(targetRepoId)
      state.setActiveWorktree(worktree.id)
      return worktree.id
    },
    { targetRepoId: repoId, pathToRepo: repoPath }
  )
}

test.describe('Combined diff invalidation freeze repro (STA-3420)', () => {
  test.describe.configure({ mode: 'serial' })
  test.use({ seedTestRepo: false })

  test('committing under an open Staged Changes diff keeps the renderer responsive', async ({
    orcaPage
  }) => {
    await waitForSessionReady(orcaPage)
    const fixture = createIsolatedStagedLocaleDiffRepo()

    try {
      const worktreeId = await addAndActivateRepo(orcaPage, fixture.repoPath)

      const opened = await orcaPage.evaluate(
        async ({ wId, repoPath }) => {
          const store = window.__store
          if (!store) {
            throw new Error('window.__store is not available')
          }
          const status = await window.api.git.status({ worktreePath: repoPath })
          store.getState().setGitStatus(wId, status)
          const staged = status.entries.filter((entry) => entry.area === 'staged')
          if (staged.length === 0) {
            throw new Error('fixture produced no staged entries')
          }
          // Why: mirrors the Source Control "Staged Changes" tab, which snapshots entries at open.
          store.getState().openAllDiffs(wId, repoPath, undefined, 'staged', staged)

          const startedAt = performance.now()
          let editorCount = 0
          while (performance.now() - startedAt < 30_000) {
            await new Promise((resolve) => window.setTimeout(resolve, 50))
            editorCount = document.querySelectorAll('.monaco-diff-editor').length
            if (editorCount > 0) {
              await new Promise((resolve) => window.setTimeout(resolve, 1_500))
              editorCount = document.querySelectorAll('.monaco-diff-editor').length
              break
            }
          }
          return { stagedCount: staged.length, editorCount }
        },
        { wId: worktreeId, repoPath: fixture.repoPath }
      )
      console.log(`staged diff opened ${JSON.stringify(opened)}`)
      expect(opened.editorCount).toBeGreaterThan(0)

      // Why: the reported freeze starts when the open diff is invalidated by a
      // commit/rebase — the snapshot files stop having any staged diff at all.
      execFileSync('git', ['commit', '-m', 'Invalidate the open staged diff'], {
        cwd: fixture.repoPath,
        stdio: 'pipe'
      })

      const measurement = await orcaPage.evaluate(
        async ({ wId, repoPath }) => {
          const store = window.__store
          if (!store) {
            throw new Error('window.__store is not available')
          }

          const intervalMs = 50
          const samples: number[] = []
          let last = performance.now()
          let maxLagMs = 0
          const timer = window.setInterval(() => {
            const now = performance.now()
            const lag = Math.max(0, now - last - intervalMs)
            maxLagMs = Math.max(maxLagMs, lag)
            samples.push(lag)
            last = now
          }, intervalMs)

          const startedAt = performance.now()
          try {
            // Why: the file watcher pushes several status refreshes while git
            // rewrites the index; replay that churn instead of a single update.
            for (let round = 0; round < 3; round += 1) {
              const status = await window.api.git.status({ worktreePath: repoPath })
              store.getState().setGitStatus(wId, status)
              await new Promise((resolve) => window.setTimeout(resolve, 700))
            }
            await new Promise((resolve) => window.setTimeout(resolve, 3_000))
          } finally {
            window.clearInterval(timer)
          }

          const sorted = [...samples].sort((a, b) => a - b)
          return {
            elapsedMs: performance.now() - startedAt,
            maxLagMs,
            p95LagMs: sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 0,
            sampleCount: samples.length,
            editorCount: document.querySelectorAll('.monaco-diff-editor').length,
            loadingRowCount: Array.from(
              document.querySelectorAll('[data-combined-diff-section-row]')
            ).filter((row) => row.textContent?.includes('Loading diff')).length,
            sectionRowCount: document.querySelectorAll('[data-combined-diff-section-row]').length
          }
        },
        { wId: worktreeId, repoPath: fixture.repoPath }
      )

      console.log(`invalidation measurement ${JSON.stringify(measurement)}`)
      expect(measurement.maxLagMs).toBeLessThan(1_000)
    } finally {
      rmSync(fixture.repoPath, { recursive: true, force: true })
    }
  })
})
