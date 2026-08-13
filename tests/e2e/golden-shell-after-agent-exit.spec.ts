import { expect, test } from './helpers/orca-app'
import {
  configureGoldenStubAgent,
  getGoldenStubAgentLaunchEnv,
  GOLDEN_STUB_EXIT_MARKER,
  launchGoldenStubAgentFromNewTab
} from './helpers/golden-stub-agent'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  focusActiveTerminalInput,
  waitForActivePanePtyId,
  waitForTerminalOutput
} from './helpers/terminal'

test.use({ launchEnv: getGoldenStubAgentLaunchEnv() })

test('@golden opens a clean live shell after an agent exits', async ({ orcaPage }) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await ensureTerminalVisible(orcaPage)
  await configureGoldenStubAgent(orcaPage)
  await launchGoldenStubAgentFromNewTab(orcaPage)

  await orcaPage.keyboard.type('exit')
  await orcaPage.keyboard.press('Enter')
  await waitForTerminalOutput(orcaPage, GOLDEN_STUB_EXIT_MARKER, 15_000)

  const tabsBeforeShell = await orcaPage.locator('[data-testid="sortable-tab"]').count()
  await orcaPage.getByRole('button', { name: 'New tab' }).click({ force: true })
  await orcaPage
    .getByRole('menuitem', { name: /New Terminal/i })
    .first()
    .click({ force: true })
  await expect(orcaPage.locator('[data-testid="sortable-tab"]')).toHaveCount(tabsBeforeShell + 1)
  await waitForActivePanePtyId(orcaPage)

  await focusActiveTerminalInput(orcaPage)
  await orcaPage.keyboard.type('echo after-agent')
  await orcaPage.keyboard.press('Enter')
  await waitForTerminalOutput(orcaPage, 'after-agent', 15_000)

  await orcaPage.keyboard.press('Shift+Enter')
  await orcaPage.keyboard.type('echo after-shift-enter')
  await orcaPage.keyboard.press('Enter')
  await waitForTerminalOutput(orcaPage, 'after-shift-enter', 15_000)
  await expect(orcaPage.locator('[data-testid="sortable-tab"]')).toHaveCount(tabsBeforeShell + 1)
})
