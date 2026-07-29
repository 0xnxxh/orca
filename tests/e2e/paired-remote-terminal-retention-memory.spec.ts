import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { toWebTerminalSurfaceTabId } from '../../src/shared/terminal-surface-id'
import { expect, test } from './helpers/orca-app'
import {
  createRuntimeDesktopPairingOffer,
  launchPairedWebClient
} from './helpers/paired-electron-client'
import { getTerminalContent, waitForActivePanePtyId } from './helpers/terminal'
import {
  readPairedRetentionSample,
  startRendererLagProbe
} from './paired-runtime-retention-metrics'

const RETENTION_LIMIT = 2
const TARGET_WORKTREE_COUNT = 6
const PARK_DELAY_MS = 100
const FILL_ROWS = 6_000
const MIN_STAGED_BUFFER_CELLS = 1_000_000
const MAX_RETAINED_CELL_FRACTION = 0.45
const MAX_EVICTION_LAG_MS = 500
const MAX_HEAP_GROWTH_BYTES = 16 * 1024 * 1024
const scratch = mkdtempSync(path.join(os.tmpdir(), 'orca-paired-retention-memory-'))
const fixturePath = path.join(scratch, 'paired-retention-memory.mjs')

writeFileSync(
  fixturePath,
  [
    'const marker = process.argv[2]',
    'process.stdout.write(`READY:${marker}\\r\\n`)',
    "process.stdin.setEncoding('utf8')",
    "process.stdin.on('data', (data) => {",
    '  for (const command of data.split(/\\r\\n|\\r|\\n/).filter(Boolean)) {',
    "    if (command === 'FILL') {",
    `      for (let row = 0; row < ${FILL_ROWS}; row += 1) process.stdout.write(\`fill-${'${marker}'}-${'${row}'}-${'x'.repeat(80)}\\r\\n\`)`,
    '      process.stdout.write(`FILLED:${marker}\\r\\n`)',
    '      continue',
    '    }',
    '    process.stdout.write(`LIVE:${command}\\r\\n`)',
    '  }',
    '})',
    'process.stdin.resume()'
  ].join('\n')
)

test.afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

function fixtureCommand(marker: string): string {
  const command = [process.execPath, fixturePath, marker]
  return process.platform === 'win32'
    ? command.map((value) => `"${value.replaceAll('"', '""')}"`).join(' ')
    : command.map(shellQuote).join(' ')
}

async function callRuntime<TResult>(page: Page, method: string, params: unknown): Promise<TResult> {
  return page.evaluate(
    async ({ method, params }) => {
      const response = await window.api.runtime.call({ method, params })
      if (!response.ok) {
        throw new Error(`${response.error.code}: ${response.error.message}`)
      }
      return response.result
    },
    { method, params }
  ) as Promise<TResult>
}

type RemoteTab = {
  marker: string
  originalPtyId: string
  tabId: string
  terminal: string
  worktreeId: string
}

test('bounds retained buffers across real paired worktrees and preserves PTYs @headful', async ({
  electronApp,
  orcaPage
}) => {
  test.setTimeout(240_000)
  const seed = await orcaPage.evaluate(() => {
    const state = window.__store?.getState()
    const worktrees = state?.allWorktrees() ?? []
    const active = worktrees.find((worktree) => worktree.id === state?.activeWorktreeId)
    if (!active) {
      throw new Error('Paired retention host has no active seeded worktree')
    }
    return { repoId: active.repoId, worktreeIds: worktrees.map((worktree) => worktree.id) }
  })
  const offer = await createRuntimeDesktopPairingOffer(orcaPage)
  const client = await launchPairedWebClient(electronApp, offer, {
    terminalParkingDelayMs: PARK_DELAY_MS,
    terminalRetentionLimit: RETENTION_LIMIT
  })
  const createdWorktreeIds: string[] = []
  const remoteTabs: RemoteTab[] = []
  try {
    await client.page.evaluate(async () => {
      await window.__store
        ?.getState()
        .updateSettings({ terminalHiddenWorktreeRetentionBudget: false })
    })
    const worktreeIds = seed.worktreeIds.slice(0, TARGET_WORKTREE_COUNT)
    while (worktreeIds.length < TARGET_WORKTREE_COUNT) {
      const suffix = `${Date.now()}-${worktreeIds.length}`
      const created = await callRuntime<{ worktree: { id: string } }>(
        client.page,
        'worktree.create',
        {
          repo: seed.repoId,
          name: `paired-retention-${suffix}`,
          setupDecision: 'skip',
          activate: false,
          noParent: true
        }
      )
      worktreeIds.push(created.worktree.id)
      createdWorktreeIds.push(created.worktree.id)
    }
    await expect
      .poll(
        () =>
          client.page.evaluate(
            (ids) =>
              ids.every((id) =>
                window.__store
                  ?.getState()
                  .allWorktrees()
                  .some((w) => w.id === id)
              ),
            worktreeIds
          ),
        { timeout: 30_000 }
      )
      .toBe(true)

    for (const [index, worktreeId] of worktreeIds.entries()) {
      const marker = `PAIR_RETENTION_${index}`
      const created = await callRuntime<{
        tab: { parentTabId: string; terminal: string | null }
      }>(client.page, 'session.tabs.createTerminal', {
        worktree: `id:${worktreeId}`,
        command: fixtureCommand(marker),
        activate: false,
        select: false,
        navigation: 'caller'
      })
      if (!created.tab.terminal) {
        throw new Error(`Paired retention terminal ${index} was not published`)
      }
      const terminal = created.tab.terminal
      const tabId = toWebTerminalSurfaceTabId(created.tab.parentTabId)
      await client.page.evaluate(
        (id) => window.__store?.getState().setActiveWorktree(id),
        worktreeId
      )
      const tab = client.page.locator(`[data-testid="sortable-tab"][data-tab-id="${tabId}"]`)
      await expect(tab).toBeVisible({ timeout: 30_000 })
      await tab.click()
      const originalPtyId = await waitForActivePanePtyId(client.page, 30_000)
      await callRuntime(client.page, 'terminal.send', {
        terminal,
        text: 'FILL',
        enter: true,
        client: { id: 'paired-retention-memory-e2e', type: 'desktop' }
      })
      await expect
        .poll(() => getTerminalContent(client.page), { timeout: 30_000 })
        .toContain(`FILLED:${marker}`)
      remoteTabs.push({ marker, originalPtyId, tabId, terminal, worktreeId })
    }

    await client.page.evaluate(() => window.__store?.getState().setActiveView('tasks'))
    await expect
      .poll(
        () =>
          client.page.evaluate(
            (ids) => ids.filter((id) => window.__paneManagers?.has(id)).length,
            remoteTabs.map((tab) => tab.tabId)
          ),
        { timeout: 10_000 }
      )
      .toBe(TARGET_WORKTREE_COUNT)
    const baseline = await readPairedRetentionSample(
      client.page,
      remoteTabs.map((tab) => tab.tabId)
    )
    expect(baseline.bufferCells).toBeGreaterThan(MIN_STAGED_BUFFER_CELLS)

    const lagProbe = await startRendererLagProbe(client.page)
    await client.page.evaluate(async () => {
      await window.__store
        ?.getState()
        .updateSettings({ terminalHiddenWorktreeRetentionBudget: true })
    })
    await expect
      .poll(
        () =>
          client.page.evaluate(
            (ids) => ids.filter((id) => window.__paneManagers?.has(id)).length,
            remoteTabs.map((tab) => tab.tabId)
          ),
        { timeout: 10_000 }
      )
      .toBe(RETENTION_LIMIT)
    const maxLagMs = await lagProbe.evaluate((probe) => probe.stop())
    await lagProbe.dispose()
    const after = await readPairedRetentionSample(
      client.page,
      remoteTabs.map((tab) => tab.tabId)
    )
    expect(after.bufferCells).toBeLessThanOrEqual(baseline.bufferCells * MAX_RETAINED_CELL_FRACTION)
    expect(after.mountedTargetManagers).toBe(RETENTION_LIMIT)
    expect(maxLagMs).toBeLessThan(MAX_EVICTION_LAG_MS)
    if (baseline.heapBytes !== null && after.heapBytes !== null) {
      expect(after.heapBytes).toBeLessThanOrEqual(baseline.heapBytes + MAX_HEAP_GROWTH_BYTES)
    }

    const evicted = await client.page.evaluate(
      (tabs) => tabs.find((tab) => !window.__paneManagers?.has(tab.tabId)) ?? null,
      remoteTabs
    )
    if (!evicted) {
      throw new Error('Retention budget did not evict a paired terminal')
    }
    await client.page.evaluate((worktreeId) => {
      const state = window.__store?.getState()
      state?.setActiveView('terminal')
      state?.setActiveWorktree(worktreeId)
    }, evicted.worktreeId)
    const restored = client.page.locator(
      `[data-testid="sortable-tab"][data-tab-id="${evicted.tabId}"]`
    )
    await expect(restored).toBeVisible({ timeout: 30_000 })
    await restored.click()
    expect(await waitForActivePanePtyId(client.page, 30_000)).toBe(evicted.originalPtyId)
    const liveMarker = `AFTER_RETENTION_${Date.now()}`
    await callRuntime(client.page, 'terminal.send', {
      terminal: evicted.terminal,
      text: liveMarker,
      enter: true,
      client: { id: 'paired-retention-memory-e2e', type: 'desktop' }
    })
    await expect
      .poll(() => getTerminalContent(client.page), { timeout: 30_000 })
      .toContain(`LIVE:${liveMarker}`)
  } finally {
    for (const tab of remoteTabs) {
      await callRuntime(client.page, 'terminal.closeTab', { terminal: tab.terminal }).catch(
        () => undefined
      )
    }
    await client.page
      .evaluate((id) => window.__store?.getState().setActiveWorktree(id), seed.worktreeIds[0])
      .catch(() => undefined)
    for (const worktreeId of createdWorktreeIds.toReversed()) {
      await callRuntime(client.page, 'worktree.rm', {
        worktree: `id:${worktreeId}`,
        force: true,
        runHooks: false
      }).catch(() => undefined)
    }
    await client.dispose()
  }
})
