import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from './helpers/orca-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'

const relativeFilePath =
  'packages/orca/src/renderer/src/components/navigation/worktree/secondary-nav/SecondaryNav.tsx'

test('new-tab file results prioritize the filename and reveal the full path on hover', async ({
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

  await row.hover({ force: true })
  await expect(
    orcaPage.locator('[role="tooltip"]').filter({ hasText: relativeFilePath })
  ).toBeVisible()

  const proofPath = process.env.ORCA_STA3424_PROOF_PATH
  if (proofPath) {
    await orcaPage.screenshot({ path: proofPath })
  }
})
