/**
 * Regression coverage for #10252: deleting one folder-workspace instance must
 * not kill sessions belonging to its siblings.
 *
 * Folder-workspace instances share a single checkout directory but carry
 * distinct ids (`${repoId}::${sharedPath}::workspace:<uuid>`). The teardown
 * sweep's cwd-ownership fallback (for untagged sessions with no worktreeId)
 * used to collapse a deleted instance's id to that shared path and sweep every
 * untagged session running under it — including live sibling agents/terminals.
 *
 * - `sibling terminals stay alive and interactive` proves the normal (tagged)
 *   sibling path survives deletion on every platform.
 * - `untagged sibling session survives` reproduces the exact collateral kill:
 *   an untagged session whose cwd is the shared folder path. It is the test
 *   that fails if the cwd-fallback guard is removed (revert-proven).
 */

import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { ensureTerminalVisible, switchToWorktree } from './helpers/store'
import { execInTerminal, waitForActivePanePtyId, waitForTerminalOutput } from './helpers/terminal'

// This suite registers its own folder repo; skip the default seeded git repo.
test.use({ seedTestRepo: false })

/**
 * Register `folderPath` as a non-git folder repo and create two workspace
 * instances (A, B) under it. Returns the repo id plus both instance ids.
 *
 * Why the diff dance: `createWorktree` resolves to null for folder repos even
 * on success, so instance ids are read back from `worktreesByRepo` (excluding
 * the root workspace `${repoId}::${sharedPath}`).
 */
async function registerFolderRepoWithTwoInstances(
  page: Page,
  folderPath: string
): Promise<{ repoId: string; a: string; b: string }> {
  return page.evaluate(async (path) => {
    const store = window.__store!
    const repo = await store.getState().addNonGitFolder(path)
    if (!repo) {
      throw new Error('addNonGitFolder returned no repo')
    }
    const rootId = `${repo.id}::${repo.path}`
    const instanceIds = (): string[] =>
      (store.getState().worktreesByRepo[repo.id] ?? [])
        .map((worktree) => worktree.id)
        .filter((id) => id !== rootId)

    await store.getState().createWorktree(repo.id, 'sibling-A')
    const a = instanceIds()[0]
    if (!a) {
      throw new Error('first folder instance was not created')
    }
    await store.getState().createWorktree(repo.id, 'sibling-B')
    const b = instanceIds().find((id) => id !== a)
    if (!b) {
      throw new Error('second folder instance was not created')
    }
    return { repoId: repo.id, a, b }
  }, folderPath)
}

async function hasPty(page: Page, ptyId: string): Promise<boolean | null> {
  return page.evaluate((id) => window.api.pty.hasPty(id), ptyId)
}

async function removeFolderInstance(page: Page, worktreeId: string): Promise<void> {
  await page.evaluate(async (id) => {
    await window.__store!.getState().removeWorktree(id, true)
  }, worktreeId)
}

test('deleting a folder instance leaves sibling terminals alive and interactive', async ({
  electronApp,
  orcaPage
}) => {
  const homeDir = await electronApp.evaluate(({ app }) => app.getPath('home'))
  const { a, b } = await registerFolderRepoWithTwoInstances(orcaPage, homeDir)

  // Open a real terminal (tagged session) in sibling A and prove it echoes.
  await switchToWorktree(orcaPage, a)
  await ensureTerminalVisible(orcaPage)
  const ptyA = await waitForActivePanePtyId(orcaPage)
  await execInTerminal(orcaPage, ptyA, 'echo ORCA_SIBLING_A_BEFORE')
  await waitForTerminalOutput(orcaPage, 'ORCA_SIBLING_A_BEFORE')

  // Open a real terminal in sibling B (the instance we will delete).
  await switchToWorktree(orcaPage, b)
  await ensureTerminalVisible(orcaPage)
  const ptyB = await waitForActivePanePtyId(orcaPage)
  await execInTerminal(orcaPage, ptyB, 'echo ORCA_SIBLING_B_BEFORE')
  await waitForTerminalOutput(orcaPage, 'ORCA_SIBLING_B_BEFORE')

  expect(ptyA).not.toBe(ptyB)

  // Delete B through the real removal flow (force = destructive teardown).
  await removeFolderInstance(orcaPage, b)

  // B's session is physically gone; A's must remain.
  expect(await hasPty(orcaPage, ptyB)).toBe(false)
  expect(await hasPty(orcaPage, ptyA)).toBe(true)

  // A's terminal is still the same live session AND still interactive.
  await switchToWorktree(orcaPage, a)
  await ensureTerminalVisible(orcaPage)
  const ptyAAfter = await waitForActivePanePtyId(orcaPage)
  expect(ptyAAfter).toBe(ptyA)
  await execInTerminal(orcaPage, ptyAAfter, 'echo ORCA_SIBLING_A_AFTER')
  await waitForTerminalOutput(orcaPage, 'ORCA_SIBLING_A_AFTER')
})

test('deleting a folder instance spares an untagged session in the shared folder', async ({
  electronApp,
  orcaPage
}) => {
  // Why skip: staging an untagged session's tracked cwd requires emitting OSC 7
  // from a POSIX shell (`cd` + `printf`). The cross-platform fix itself is unit
  // tested; this E2E pins the daemon-reported-cwd path on macOS/Linux.
  test.skip(process.platform === 'win32', 'OSC 7 cwd staging requires a POSIX shell')

  const homeDir = await electronApp.evaluate(({ app }) => app.getPath('home'))
  const { a, b } = await registerFolderRepoWithTwoInstances(orcaPage, homeDir)

  const spawned = await orcaPage.evaluate(
    async ({ a, b }) => {
      const spawn = window.api.pty.spawn
      const taggedA = await spawn({ cols: 80, rows: 24, worktreeId: a })
      const taggedB = await spawn({ cols: 80, rows: 24, worktreeId: b })
      // No worktreeId → an untagged session (session.worktreeId === undefined),
      // the quadrant the cwd-ownership fallback governs.
      const untagged = await spawn({ cols: 80, rows: 24 })
      return { taggedA: taggedA.id, taggedB: taggedB.id, untagged: untagged.id }
    },
    { a, b }
  )

  // Drive the untagged shell into the shared folder path and have the daemon
  // track that cwd via OSC 7 — the real #10252 collateral scenario. Re-emit on
  // each poll until the daemon reports the cwd (shell may not be ready at once).
  await expect
    .poll(
      async () => {
        await orcaPage.evaluate(
          ({ id, folderPath }) => {
            window.api.pty.write(
              id,
              `cd '${folderPath}'; printf '\\033]7;file://localhost%s\\007' '${folderPath}'\r`
            )
          },
          { id: spawned.untagged, folderPath: homeDir }
        )
        return orcaPage.evaluate(async (id) => {
          const sessions = await window.api.pty.listSessions()
          return sessions.find((session) => session.id === id)?.cwd ?? ''
        }, spawned.untagged)
      },
      { timeout: 10_000, message: 'untagged session cwd never became the shared folder path' }
    )
    .toBe(homeDir)

  await removeFolderInstance(orcaPage, b)

  // B (tagged, prefix-owned) is swept; A (tagged sibling) and the untagged
  // session in the shared folder both survive.
  expect(await hasPty(orcaPage, spawned.taggedB)).toBe(false)
  expect(await hasPty(orcaPage, spawned.taggedA)).toBe(true)
  expect(await hasPty(orcaPage, spawned.untagged)).toBe(true)
})
