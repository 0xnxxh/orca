import type { Page } from '@stablyai/playwright-test'

import { test, expect } from './helpers/orca-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  execInTerminal,
  getTerminalContent,
  waitForActivePanePtyId,
  waitForActiveTerminalManager,
  waitForTerminalOutput
} from './helpers/terminal'
import {
  cleanupDockerSshRelayTarget,
  startDockerSshRelayTarget,
  type DockerSshRelayTarget
} from './helpers/docker-ssh-relay-target'
import {
  connectDockerSshRelayTarget,
  reconnectDockerSshRelayTarget
} from './helpers/docker-ssh-relay-connection'

const RUN_DOCKER_SSH = process.env.ORCA_E2E_SSH_DOCKER === '1'

/**
 * The two regressions this covers both shipped and both reached a user, because nothing here
 * asserted what a pane actually SHOWS after a reconnect:
 *
 * 1. Panes came back blank. The relay treated the reconnecting client as one that already held the
 *    stream and returned no scrollback, while the renderer had disposed the xterm with its buffer.
 * 2. A tab created afterwards came up with no prompt and stayed generically titled, because the
 *    reconnect prepaint could still fire on a spent mount.
 *
 * Reading the pane's own text is the point. Asserting a pty id, a status, or a spy call is what let
 * both of these through: every one of those was correct while the screen was wrong.
 */
async function openTerminalTab(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const store = window.__store
    if (!store) {
      throw new Error('Store unavailable')
    }
    await store.getState().openNewTerminalTabInActiveWorkspace()
  })
}

test.describe('SSH reconnect pane restore', () => {
  test.skip(!RUN_DOCKER_SSH, 'Set ORCA_E2E_SSH_DOCKER=1 to run the dockerized SSH relay tests')

  test('restores pane content on reconnect and still opens a usable new tab', async ({
    orcaPage
  }, testInfo) => {
    test.slow()
    let target: DockerSshRelayTarget | null = null
    try {
      target = startDockerSshRelayTarget(testInfo)
      await waitForSessionReady(orcaPage)
      await waitForActiveWorktree(orcaPage)
      await connectDockerSshRelayTarget(orcaPage, target)
      await ensureTerminalVisible(orcaPage, 45_000)
      await waitForActiveTerminalManager(orcaPage, 60_000)
      const ptyId = await waitForActivePanePtyId(orcaPage, 60_000)

      // A marker rather than a prompt: a prompt reappears on its own after a reconnect, so it cannot
      // distinguish restored scrollback from a fresh shell. This string only exists if the pane kept
      // what it had.
      const marker = `RECONNECT_MARKER_${Date.now()}`
      await execInTerminal(orcaPage, ptyId, `echo ${marker}`)
      await waitForTerminalOutput(orcaPage, marker, 30_000)

      await reconnectDockerSshRelayTarget(orcaPage, target.targetId)
      await waitForActiveTerminalManager(orcaPage, 60_000)
      await waitForActivePanePtyId(orcaPage, 60_000)

      // REGRESSION 1: the pane painted nothing at all here, because the relay withheld the replay.
      await waitForTerminalOutput(orcaPage, marker, 60_000)

      // REGRESSION 2: opening a tab AFTER a reconnect. The prepaint could still fire on this mount
      // and write over the new shell, leaving a pane with no prompt and a generic tab title.
      await openTerminalTab(orcaPage)
      await waitForActiveTerminalManager(orcaPage, 60_000)
      const freshPtyId = await waitForActivePanePtyId(orcaPage, 60_000)
      expect(freshPtyId).not.toBe(ptyId)

      // The new pane must reach a shell that answers, which is what "usable" means and what a blank
      // pane fails. Echoing proves the shell read input and wrote back, not merely that a pty exists.
      const freshMarker = `NEW_TAB_MARKER_${Date.now()}`
      await execInTerminal(orcaPage, freshPtyId, `echo ${freshMarker}`)
      await waitForTerminalOutput(orcaPage, freshMarker, 60_000)

      // And it must be a FRESH shell, not a repaint of the old pane's history.
      const freshContent = await getTerminalContent(orcaPage, 8000)
      expect(freshContent).not.toContain(marker)

      // The title is the cheap signal the reported bug showed: it only stays generic when the shell
      // never printed a prompt for Orca to read one from.
      await expect
        .poll(
          async () =>
            orcaPage.evaluate(() => {
              const store = window.__store
              const state = store?.getState()
              const worktreeId = state?.activeWorktreeId
              if (!state || !worktreeId) {
                return null
              }
              const activeTabId = state.activeTabIdByWorktree?.[worktreeId]
              const tabs = state.tabsByWorktree?.[worktreeId] ?? []
              return tabs.find((tab) => tab.id === activeTabId)?.title ?? null
            }),
          { timeout: 60_000, message: 'New tab kept its placeholder title' }
        )
        .not.toMatch(/^Terminal \d+$/)
    } finally {
      if (target) {
        cleanupDockerSshRelayTarget(target)
      }
    }
  })
})
