import { expect } from '@stablyai/playwright-test'
import type { Page } from '@stablyai/playwright-test'
import { getActiveTabId } from './store'

const SORTABLE_TAB = '[data-testid="sortable-tab"]'

export async function createTerminalTabFromMenu(page: Page): Promise<string> {
  const tabsBefore = await page.locator(SORTABLE_TAB).count()
  const activeBefore = await getActiveTabId(page)

  await page.getByRole('button', { name: 'New tab' }).click()
  await page
    .getByRole('menuitem', { name: /New Terminal/i })
    .first()
    .click()

  await expect
    .poll(() => page.locator(SORTABLE_TAB).count(), {
      timeout: 10_000,
      message: 'New Terminal did not render a new tab in the tab bar'
    })
    .toBe(tabsBefore + 1)

  let tabId: string | null = null
  await expect
    .poll(
      async () => {
        tabId = await getActiveTabId(page)
        return Boolean(tabId && tabId !== activeBefore)
      },
      { timeout: 10_000, message: 'New Terminal did not become the active tab' }
    )
    .toBe(true)

  if (!tabId) {
    throw new Error('New Terminal tab id was unavailable after creation')
  }
  return tabId
}
