/**
 * Regression proof for #8291 — a live TUI loses mouse tracking after a
 * daemon reattach (the "drag selection appeared after an in-app update
 * restart" report).
 *
 * Shape of the bug: on reattach the renderer replayed the daemon snapshot
 * (which rehydrates the session's DECSET mouse modes) and then immediately
 * wrote POST_REPLAY_REATTACH_RESET, whose RESET_MOUSE_REPORTING wiped the
 * modes the snapshot had just restored. xterm then believed the still-running
 * TUI had no mouse tracking, so it re-enabled its own row-wise drag selection
 * over the TUI and stopped forwarding wheel gestures to it.
 *
 * What this spec drives, all through the rendered surface:
 *   1. Start a real alt-screen TUI (the shared visible-tui fixture) that arms
 *      ?1003h + ?1006h, in a daemon-backed pane.
 *   2. Quit Orca and relaunch against the same userDataDir — the daemon and
 *      the TUI process survive, so the second launch warm-reattaches.
 *   3. After the reattach replay has been parsed, drag the mouse across three
 *      TUI rows and scroll the wheel over the pane, then assert on what the
 *      terminal renders: no row selection over the TUI, and the TUI's own
 *      `offset=` row advancing because the wheel reached it as mouse reports.
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import {
  execInTerminal,
  sendToTerminal,
  waitForActivePanePtyId,
  waitForActiveTerminalManager,
  waitForPaneCount
} from './helpers/terminal'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { attachRepoAndOpenTerminal, createRestartSession } from './helpers/orca-restart'

const VISIBLE_TUI_FIXTURE_PATH = path.join(
  process.cwd(),
  'tests/e2e/fixtures/visible-tui-scroll-fixture.cjs'
)

// One SGR wheel-down report, as the fixture's stdin parser expects it. Used as
// a settle beacon: the TUI can only repaint `offset=1` from bytes produced
// after the relaunch, so seeing it proves the reattach replay already landed.
const WHEEL_DOWN_REPORT = '\x1b[<65;10;10M'

/**
 * Why not the shared seeded repo: this spec spans a quit/relaunch cycle, and
 * globalTeardown of any concurrently running e2e process deletes whatever repo
 * the machine-global pointer file names — which can be this test's repo, mid
 * restart. A private repo that no pointer file references cannot be collected
 * out from under the second launch.
 */
function createIsolatedProofRepo(): string {
  // Why realpathSync: macOS os.tmpdir() symlinks through /private, and Orca
  // canonicalizes repo.path on add, so the store would not match otherwise.
  const repoDir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'orca-mouse-reattach-repo-')))
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: repoDir, stdio: 'pipe' })
  }
  git('init', '-q')
  git('config', 'user.email', 'e2e@test.local')
  git('config', 'user.name', 'E2E Test')
  writeFileSync(path.join(repoDir, 'README.md'), '# Orca mouse-mode reattach proof repo\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'Seed commit for the reattach mouse-mode proof')
  return repoDir
}

type TerminalSurface = {
  mouseEventsClass: boolean
  mouseTrackingMode: string
  hasSelection: boolean
  selectionText: string
  visibleText: string
  screen: { left: number; top: number; width: number; height: number; cellHeight: number }
}

// Why one evaluate for everything: it flushes xterm's write queue first, so a
// caller can never sample the mode/selection state mid-replay.
async function readTerminalSurface(page: Page): Promise<TerminalSurface | null> {
  return page.evaluate(async () => {
    const state = window.__store?.getState()
    const worktreeId = state?.activeWorktreeId
    const tabId =
      state?.activeTabType === 'terminal'
        ? state.activeTabId
        : worktreeId
          ? (state?.activeTabIdByWorktree?.[worktreeId] ?? null)
          : null
    const manager = tabId ? window.__paneManagers?.get(tabId) : null
    const pane = manager?.getActivePane?.() ?? manager?.getPanes?.()[0] ?? null
    const element = pane?.terminal?.element ?? null
    const screenElement = element?.querySelector<HTMLElement>('.xterm-screen') ?? null
    if (!pane || !element || !screenElement) {
      return null
    }
    // Why a zero-length write: xterm parses writes off a FIFO queue, so this
    // callback fires only after every earlier replay/reset write was parsed.
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 3000)
      pane.terminal.write('', () => {
        clearTimeout(timer)
        resolve()
      })
    })
    const buffer = pane.terminal.buffer.active
    const lines: string[] = []
    for (let row = 0; row < pane.terminal.rows; row += 1) {
      lines.push(buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? '')
    }
    const rect = screenElement.getBoundingClientRect()
    return {
      mouseEventsClass: element.classList.contains('enable-mouse-events'),
      mouseTrackingMode: String(pane.terminal.modes?.mouseTrackingMode ?? 'unavailable'),
      hasSelection: pane.terminal.hasSelection(),
      selectionText: pane.terminal.getSelection(),
      visibleText: lines.join('\n'),
      screen: {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        cellHeight: rect.height / Math.max(1, pane.terminal.rows)
      }
    }
  })
}

async function waitForTerminalSurface(
  page: Page,
  predicate: (surface: TerminalSurface) => boolean,
  message: string,
  timeoutMs = 30_000
): Promise<TerminalSurface> {
  await expect
    .poll(
      async () => {
        const surface = await readTerminalSurface(page)
        return surface !== null && predicate(surface)
      },
      { timeout: timeoutMs, message }
    )
    .toBe(true)
  const surface = await readTerminalSurface(page)
  if (!surface) {
    throw new Error(`${message}: terminal surface disappeared after settling`)
  }
  return surface
}

function readRenderedTuiOffset(visibleText: string): number | null {
  const match = /TUI_SCROLL_READY offset=(\d+)/.exec(visibleText)
  return match ? Number(match[1]) : null
}

/** Real CDP drag across three TUI rows — the gesture from the bug report. */
async function dragAcrossTuiRows(page: Page, screen: TerminalSurface['screen']): Promise<void> {
  const startX = screen.left + Math.min(24, screen.width / 4)
  const startY = screen.top + screen.cellHeight * 2.5
  const endX = screen.left + screen.width * 0.6
  const endY = startY + screen.cellHeight * 3
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(endX, endY, { steps: 12 })
  await page.mouse.up()
}

// Why: this suite quits and relaunches Orca against one userDataDir, and the
// second launch must find the daemon (and the TUI it owns) still alive.
test.describe.configure({ mode: 'serial' })

test.describe('terminal reattach mouse mode', () => {
  test('live TUI keeps mouse tracking after an app restart reattach instead of falling back to drag selection', async (// oxlint-disable-next-line no-empty-pattern -- Playwright's second fixture arg is testInfo; the first must be an object destructure to opt out of the default fixture set.
  {}, testInfo) => {
    const repoPath = createIsolatedProofRepo()
    const session = createRestartSession(testInfo)
    let firstApp: ElectronApplication | null = null
    let secondApp: ElectronApplication | null = null

    try {
      // ── First launch: a real TUI arms mouse reporting ──────────────────
      const firstLaunch = await session.launch()
      firstApp = firstLaunch.app
      await attachRepoAndOpenTerminal(firstLaunch.page, repoPath)
      await waitForSessionReady(firstLaunch.page)
      await waitForActiveWorktree(firstLaunch.page)
      await ensureTerminalVisible(firstLaunch.page)
      await waitForActiveTerminalManager(firstLaunch.page, 30_000)
      await waitForPaneCount(firstLaunch.page, 1, 30_000)

      const firstPtyId = await waitForActivePanePtyId(firstLaunch.page)
      await execInTerminal(
        firstLaunch.page,
        firstPtyId,
        `node ${JSON.stringify(VISIBLE_TUI_FIXTURE_PATH)}`
      )

      const beforeRestart = await waitForTerminalSurface(
        firstLaunch.page,
        (surface) =>
          surface.visibleText.includes('TUI_SCROLL_READY') && surface.mouseEventsClass === true,
        'TUI fixture never armed mouse reporting before the restart'
      )
      expect(beforeRestart.mouseTrackingMode).toBe('any')

      // Why: the daemon is a detached fork, so closing the app leaves this PTY
      // — and the TUI running inside it — alive for the relaunch to reattach.
      await session.close(firstApp)
      firstApp = null

      // ── Second launch: warm reattach to the still-running TUI ──────────
      const secondLaunch = await session.launch()
      secondApp = secondLaunch.app
      await waitForSessionReady(secondLaunch.page)
      await waitForActiveWorktree(secondLaunch.page)
      await ensureTerminalVisible(secondLaunch.page)
      await waitForActiveTerminalManager(secondLaunch.page, 30_000)
      await waitForPaneCount(secondLaunch.page, 1, 30_000)
      await secondLaunch.page.evaluate(() =>
        window.__store?.getState().updateSettings({ terminalTuiScrollSensitivity: 1 })
      )

      // Beacon: drive one report straight down the PTY so the TUI repaints
      // `offset=1`. That row can only reach the pane through the reattach
      // stream, so its arrival is the deterministic "replay + reset applied"
      // point — no sleep needed before sampling the modes.
      const secondPtyId = await waitForActivePanePtyId(secondLaunch.page)
      await sendToTerminal(secondLaunch.page, secondPtyId, WHEEL_DOWN_REPORT)
      const afterReattach = await waitForTerminalSurface(
        secondLaunch.page,
        (surface) => readRenderedTuiOffset(surface.visibleText) === 1,
        'Reattached pane never rendered the live TUI repaint after the restart'
      )

      // ── The reported symptom: drag now paints a selection over the TUI ──
      await dragAcrossTuiRows(secondLaunch.page, afterReattach.screen)
      const afterDrag = await readTerminalSurface(secondLaunch.page)
      // Why a screenshot and not the video fixture: this spec quits and relaunches Orca,
      // so the recorder's WebM never flushes. This frame IS the proof — on main the drag
      // paints an xterm row selection across the live TUI; here it must stay clean.
      const proofShot = process.env.ORCA_E2E_PROOF_SCREENSHOT
      if (proofShot) {
        await secondLaunch.page.screenshot({ path: proofShot })
      }
      expect(afterDrag, 'terminal surface unavailable after the drag').not.toBeNull()
      expect(
        afterDrag!.selectionText,
        'dragging over a live mouse-tracking TUI must not paint xterm row selection'
      ).toBe('')
      expect(afterDrag!.hasSelection).toBe(false)

      // ── And the wheel must still reach the TUI as mouse reports ─────────
      const wheelTargetX = afterReattach.screen.left + afterReattach.screen.width / 2
      const wheelTargetY = afterReattach.screen.top + afterReattach.screen.height / 2
      await secondLaunch.page.mouse.move(wheelTargetX, wheelTargetY)
      for (let i = 0; i < 5; i += 1) {
        await secondLaunch.page.mouse.wheel(0, Math.min(49, afterReattach.screen.cellHeight))
      }
      const afterWheel = await waitForTerminalSurface(
        secondLaunch.page,
        (surface) => (readRenderedTuiOffset(surface.visibleText) ?? 0) > 1,
        'Wheel gestures never reached the reattached TUI — its rendered offset row never advanced',
        15_000
      )
      expect(readRenderedTuiOffset(afterWheel.visibleText)).toBeGreaterThan(1)
      expect(afterWheel.mouseEventsClass).toBe(true)
      expect(afterWheel.mouseTrackingMode).toBe('any')
    } finally {
      if (secondApp) {
        await session.close(secondApp)
      }
      if (firstApp) {
        await session.close(firstApp)
      }
      await session.dispose()
      rmSync(repoPath, { recursive: true, force: true })
    }
  })
})
