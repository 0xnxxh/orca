/**
 * E2E proof for #8813 — the worktree card status lane swallowed every status colour.
 *
 * Why: `WorktreeCardStatusSlot` let passive git identity (the grey GitBranch
 * glyph) replace the status dot for `active`, `done` *and* `inactive`. Since a
 * git worktree always has a branch, the lane rendered the same grey branch
 * glyph no matter what the workspace was doing — an emerald "Active" dot could
 * never appear. Identity is now only allowed to fill the lane for `inactive`.
 *
 * The spec drives the real sidebar: it turns on the new card style, proves a
 * quiet workspace still shows the branch identity glyph, then activates that
 * workspace through its sidebar row and asserts the lane flips to the emerald
 * status dot.
 */

import type { Locator, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import {
  waitForSessionReady,
  waitForActiveWorktree,
  getAllWorktreeIds,
  ensureTerminalVisible
} from './helpers/store'
import { worktreeRow, worktreeRowSurface } from './worktree-row-locators'

function statusLane(page: Page, worktreeId: string): Locator {
  return worktreeRow(page, worktreeId).locator('[data-worktree-card-status-slot]').first()
}

function statusDot(page: Page, worktreeId: string): Locator {
  return statusLane(page, worktreeId).locator('span.bg-emerald-500').first()
}

function branchIdentityGlyph(page: Page, worktreeId: string): Locator {
  return statusLane(page, worktreeId).locator('svg.lucide-git-branch')
}

// Why: setup-only gate. The activity heuristic reads live PTY ids, not tab rows,
// so asserting the lane before the PTY attaches races the spawn.
async function waitForLivePty(page: Page, worktreeId: string): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate((id) => {
          const state = window.__store!.getState()
          return (state.tabsByWorktree[id] ?? []).some(
            (tab) => (state.ptyIdsByTabId[tab.id] ?? []).length > 0
          )
        }, worktreeId),
      { timeout: 30_000, message: `No live PTY attached for worktree ${worktreeId}` }
    )
    .toBe(true)
}

test.describe('Worktree card status indicator', () => {
  test.beforeEach(async ({ orcaPage }) => {
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)
  })

  test('paints the emerald Active dot instead of the grey branch glyph once a workspace goes live', async ({
    orcaPage
  }) => {
    const liveWorktreeId = await waitForActiveWorktree(orcaPage)
    await ensureTerminalVisible(orcaPage)
    await waitForLivePty(orcaPage, liveWorktreeId)

    // Setup only: the status lane is a new-card-style surface, and identity is
    // what the bug let win, so the "branch" card property must be on.
    await orcaPage.evaluate(async () => {
      const state = window.__store!.getState()
      await state.updateSettings({ experimentalNewWorktreeCardStyle: true })
      state.setWorktreeCardProperties(['status', 'unread', 'branch'])
    })

    const quietWorktreeId = (await getAllWorktreeIds(orcaPage)).find((id) => id !== liveWorktreeId)
    if (!quietWorktreeId) {
      throw new Error('Seeded repo did not expose a second worktree to keep quiet')
    }

    // 1. The quiet workspace legitimately shows git identity — that path must survive.
    await expect(branchIdentityGlyph(orcaPage, quietWorktreeId)).toBeVisible()
    await expect(statusLane(orcaPage, quietWorktreeId)).toHaveText('Branch')

    // 2. The workspace that already owns a live terminal must show its status
    // colour, not identity. Before the fix this lane rendered the same grey
    // branch glyph as the quiet card above.
    await expect(statusDot(orcaPage, liveWorktreeId)).toBeVisible()
    await expect(statusLane(orcaPage, liveWorktreeId)).toHaveText('Active')
    await expect(branchIdentityGlyph(orcaPage, liveWorktreeId)).toHaveCount(0)

    // 3. Drive the quiet card live through its sidebar row and watch the lane
    // flip from grey identity to the emerald status dot.
    await worktreeRowSurface(orcaPage, quietWorktreeId).click()
    await expect
      .poll(async () => orcaPage.evaluate(() => window.__store!.getState().activeWorktreeId))
      .toBe(quietWorktreeId)
    await ensureTerminalVisible(orcaPage)
    await waitForLivePty(orcaPage, quietWorktreeId)

    await expect(statusDot(orcaPage, quietWorktreeId)).toBeVisible()
    await expect(statusLane(orcaPage, quietWorktreeId)).toHaveText('Active')
    await expect(branchIdentityGlyph(orcaPage, quietWorktreeId)).toHaveCount(0)
  })
})
