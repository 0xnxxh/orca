import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { worktreeRowSurface } from './worktree-row-locators'

// Repro capture for #6167: screenshot + label dump of the worktree row context menu.
test('captures the worktree context menu Copy items (#6167)', async ({ orcaPage }) => {
  await waitForSessionReady(orcaPage)
  const worktreeId = await waitForActiveWorktree(orcaPage)

  const surface = worktreeRowSurface(orcaPage, worktreeId)
  await expect(surface).toBeVisible()
  await surface.click({ button: 'right' })

  const menu = orcaPage.locator('[role="menu"]').first()
  await expect(menu).toBeVisible()

  const labels = await menu.locator('[role="menuitem"]').allInnerTexts()
  console.log('MENU_ITEMS=' + JSON.stringify(labels))
  const copyItems = labels.filter((label) => label.toLowerCase().includes('copy'))
  console.log('COPY_ITEMS=' + JSON.stringify(copyItems))

  const outputDir = resolve('/tmp/vbb/6167/.repro')
  mkdirSync(outputDir, { recursive: true })
  await orcaPage.screenshot({ path: resolve(outputDir, 'worktree-context-menu-head.png') })

  // Requested behavior: Copy path + Copy branch name + Copy PR URL.
  expect(copyItems.length).toBeGreaterThanOrEqual(3)
})
