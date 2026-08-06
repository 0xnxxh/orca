import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from './helpers/orca-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'

const relativeFilePath =
  'packages/orca/src/renderer/src/components/navigation/worktree/secondary-nav/SecondaryNav.tsx'

test('new-tab file results prioritize the filename and carry the full path in a native tooltip', async ({
  orcaPage,
  testRepoPath
}) => {
  const filePath = path.join(testRepoPath, ...relativeFilePath.split('/'))
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, 'export const SecondaryNav = true\n')

  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await ensureTerminalVisible(orcaPage)

  await orcaPage.getByRole('button', { name: 'New tab' }).click({ force: true })
  const input = orcaPage.getByRole('combobox', {
    name: 'Open any file, URL, agent, ...'
  })
  await input.fill('secondaryNav')

  const row = orcaPage.locator('[role="option"]').filter({ hasText: 'Open file' }).first()
  await expect(row).toBeVisible()
  await expect(row).toContainText('SecondaryNav.tsx')
  await expect(row).toContainText('packages/orca/src/renderer/src/components/navigation/')
  const rowText = await row.textContent()
  expect(rowText?.indexOf('SecondaryNav.tsx')).toBeLessThan(
    rowText?.indexOf('packages/orca/src/renderer/src/components/navigation/') ?? -1
  )

  await expect(row).toHaveAttribute('title', relativeFilePath)

  // The filename must survive intact; only the directory may be clipped, and the
  // row itself must never spill past the dropdown.
  const overflow = await row.evaluate((element) => {
    const filename = element.querySelector(':scope > span:last-of-type > span:first-child')
    return {
      filenameClipped: filename ? filename.scrollWidth > filename.clientWidth : true,
      rowClipped: element.scrollWidth > element.clientWidth
    }
  })
  expect(overflow).toEqual({ filenameClipped: false, rowClipped: false })

  await row.hover({ force: true })

  const proofPath = process.env.ORCA_STA3424_PROOF_PATH
  if (proofPath) {
    await orcaPage.screenshot({ path: proofPath })
  }
})
