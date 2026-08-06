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

  // Record the cursor in page coordinates: Playwright's boundingBox() is a
  // different space than the page's client rects under Electron, so mixing the
  // two silently compares unrelated numbers.
  await orcaPage.evaluate(() => {
    const store = window as unknown as { __pointer?: { x: number; y: number } }
    document.addEventListener(
      'mousemove',
      (event) => {
        store.__pointer = { x: event.clientX, y: event.clientY }
      },
      true
    )
  })

  // Deliberately off-centre: anchoring to the row instead of the cursor misses.
  await row.hover({ position: { x: 24, y: 12 } })

  const tooltip = orcaPage.locator('[data-slot="tooltip-content"]').filter({
    hasText: relativeFilePath
  })
  await expect(tooltip).toBeVisible()

  const placement = await tooltip.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const store = window as unknown as { __pointer?: { x: number; y: number } }
    return {
      pointer: store.__pointer,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      viewportWidth: window.innerWidth
    }
  })
  expect(placement.pointer).toBeTruthy()

  // Anchored under the cursor like a system tooltip, except where Radix shifts
  // it back inside the viewport — so the clamp is part of the expectation.
  const expectedLeft = Math.min(
    placement.pointer?.x ?? 0,
    placement.viewportWidth - placement.width
  )
  expect(Math.abs(placement.left - expectedLeft)).toBeLessThanOrEqual(2)

  // CURSOR_TOOLTIP_GAP in TabBarCreateEntryRow.tsx.
  expect(Math.abs(placement.top - ((placement.pointer?.y ?? 0) + 18))).toBeLessThanOrEqual(2)

  const proofPath = process.env.ORCA_STA3424_PROOF_PATH
  if (proofPath) {
    await orcaPage.screenshot({ path: proofPath })
  }
})
