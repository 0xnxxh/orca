import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  waitForActivePaneHookDescriptor,
  waitForActivePanePtyId,
  waitForActiveTerminalManager
} from './helpers/terminal'
import {
  createTerminalImeByteReader,
  removeTerminalImeByteReader,
  startTerminalImeByteReader,
  waitForTerminalImeBytes
} from './terminal-ime-byte-reader'
import type { GlobalSettings } from '../../src/shared/types'

const LOADING_TITLE = 'Loading conversation…'
const ERROR_TITLE = 'Could not load conversation'
const TWO_SET_KOREAN_ID = 'com.apple.inputmethod.Korean.2SetKorean'

function typeNativeKeys(processId: number, keyCodes: readonly number[]): void {
  execFileSync('osascript', [
    '-e',
    `tell application "System Events" to set frontmost of first application process whose unix id is ${processId} to true`,
    '-e',
    'tell application "System Events"',
    '-e',
    `repeat with currentKeyCode in {${keyCodes.join(', ')}}`,
    '-e',
    'key code (currentKeyCode as integer)',
    '-e',
    'delay 0.08',
    '-e',
    'end repeat',
    '-e',
    'end tell'
  ])
}

async function installNativeChatImeTrace(page: Page): Promise<void> {
  await page.locator('[data-native-chat-root="true"] textarea').evaluate((element) => {
    const textarea = element as HTMLTextAreaElement
    textarea.dataset.imeTrace = '[]'
    const record = (event: Event): void => {
      const trace = JSON.parse(textarea.dataset.imeTrace ?? '[]') as Record<string, unknown>[]
      const entry: Record<string, unknown> = {
        type: event.type,
        value: textarea.value,
        selectionStart: textarea.selectionStart,
        selectionEnd: textarea.selectionEnd
      }
      if (event instanceof KeyboardEvent) {
        Object.assign(entry, {
          key: event.key,
          keyCode: event.keyCode,
          isComposing: event.isComposing
        })
      } else if (event instanceof InputEvent) {
        Object.assign(entry, {
          data: event.data,
          inputType: event.inputType,
          isComposing: event.isComposing
        })
      } else if (event instanceof CompositionEvent) {
        entry.data = event.data
      }
      trace.push(entry)
      textarea.dataset.imeTrace = JSON.stringify(trace)
    }
    for (const type of [
      'keydown',
      'beforeinput',
      'compositionstart',
      'compositionupdate',
      'input',
      'compositionend',
      'keyup'
    ]) {
      textarea.addEventListener(type, record, true)
    }
  })
}

async function readNativeChatImeTrace(page: Page): Promise<Record<string, unknown>[]> {
  return page
    .locator('[data-native-chat-root="true"] textarea')
    .evaluate((element) => JSON.parse((element as HTMLTextAreaElement).dataset.imeTrace ?? '[]'))
}

async function enableNativeChatSetting(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const nextSettings = await window.api.settings.set({ experimentalNativeChat: true })
    window.__store?.setState({ settings: nextSettings as GlobalSettings })
  })
}

// Why: seeding agentStatusByPaneKey directly (rather than posting a real
// `/hook/claude` event) mirrors the technique agent-session-quit-resume.spec.ts
// uses to stay hermetic — it exercises the identical store → NativeChatView
// path a real Claude Code hook would drive, without an installed CLI.
async function seedClaudeProviderSession(
  page: Page,
  args: { paneKey: string; worktreeId: string; sessionId: string; transcriptPath: string }
): Promise<void> {
  await page.evaluate(({ paneKey, worktreeId, sessionId, transcriptPath }) => {
    window.__store
      ?.getState()
      .setAgentStatus(
        paneKey,
        { state: 'working', prompt: 'e2e first-flush race probe', agentType: 'claude' },
        'Claude',
        undefined,
        { worktreeId },
        { providerSession: { key: 'session_id', id: sessionId, transcriptPath } }
      )
  }, args)
}

// Why: toggleTabViewMode keys off the *unified* tab id, which can differ from
// the terminal tab id embedded in paneKey — resolve it the same way
// TerminalPane.tsx does before calling the store action a real toggle/shortcut
// would use.
async function toggleTerminalTabToChatView(
  page: Page,
  args: { tabId: string; worktreeId: string }
): Promise<void> {
  await page.evaluate(({ tabId, worktreeId }) => {
    const store = window.__store
    if (!store) {
      throw new Error('Store unavailable')
    }
    const state = store.getState()
    const unifiedTab = (state.unifiedTabsByWorktree[worktreeId] ?? []).find(
      (tab) => tab.contentType === 'terminal' && tab.entityId === tabId
    )
    if (!unifiedTab) {
      throw new Error('Unified terminal tab not found for chat toggle')
    }
    state.toggleTabViewMode(unifiedTab.id)
  }, args)
}

function claudeTranscriptLines(args: {
  sessionId: string
  userText: string
  assistantText: string
}): string {
  // Why: distinct timestamps keep the rendered order deterministic (a tie is
  // broken by uuid, which would put the assistant turn first).
  const userTime = new Date()
  const assistantTime = new Date(userTime.getTime() + 2_000)
  const lines = [
    {
      sessionId: args.sessionId,
      uuid: `${args.sessionId}-user`,
      timestamp: userTime.toISOString(),
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: args.userText }] }
    },
    {
      sessionId: args.sessionId,
      uuid: `${args.sessionId}-assistant`,
      timestamp: assistantTime.toISOString(),
      type: 'assistant',
      message: { model: 'claude-opus-4', content: [{ type: 'text', text: args.assistantText }] }
    }
  ]
  return `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`
}

test.describe('Native chat first-flush transcript race (#8401)', () => {
  test('stays in loading (never errors) until a not-yet-flushed transcript appears, then hydrates live', async ({
    orcaPage
  }, testInfo) => {
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)
    await ensureTerminalVisible(orcaPage)
    await waitForActiveTerminalManager(orcaPage, 30_000)

    const descriptor = await waitForActivePaneHookDescriptor(orcaPage)
    const [tabId] = descriptor.paneKey.split(':')
    const sessionId = `e2e-first-flush-${randomUUID()}`

    // Why: a real Claude Code session flushes its first JSONL line up to
    // minutes after launch (#8401) — this directory intentionally has no file
    // yet when the pane resolves its providerSession.
    const scratchDir = mkdtempSync(path.join(os.tmpdir(), 'orca-e2e-native-chat-'))
    const transcriptPath = path.join(scratchDir, `${sessionId}.jsonl`)

    const screenshotDir = path.join(
      process.cwd(),
      'validation-screenshots',
      `native-chat-first-flush-race-${Date.now()}`
    )
    mkdirSync(screenshotDir, { recursive: true })
    await testInfo.attach('validation-screenshot-dir', {
      body: screenshotDir,
      contentType: 'text/plain'
    })

    try {
      await enableNativeChatSetting(orcaPage)
      await seedClaudeProviderSession(orcaPage, {
        paneKey: descriptor.paneKey,
        worktreeId: descriptor.worktreeId,
        sessionId,
        transcriptPath
      })
      await toggleTerminalTabToChatView(orcaPage, { tabId, worktreeId: descriptor.worktreeId })

      await expect(orcaPage.locator('[data-native-chat-root="true"]')).toBeVisible({
        timeout: 15_000
      })
      await expect(orcaPage.getByText(LOADING_TITLE)).toBeVisible({ timeout: 10_000 })
      await expect(orcaPage.getByText(ERROR_TITLE)).toHaveCount(0)
      await orcaPage.screenshot({
        path: path.join(screenshotDir, '01-loading-no-error.png')
      })

      // Why: a short real delay proves the first readSession attempt already
      // hit the not-yet-flushed file (returning notFound) and the renderer's
      // backoff retry — not a lucky first read — is what picks it up below.
      await orcaPage.waitForTimeout(1_500)
      await expect(orcaPage.getByText(ERROR_TITLE)).toHaveCount(0)

      const userText = 'Explain the native chat first-flush race fix for #8401'
      const assistantText =
        'The main process now retries a not-yet-flushed transcript instead of caching a permanent miss.'
      writeFileSync(transcriptPath, claudeTranscriptLines({ sessionId, userText, assistantText }))

      await expect(orcaPage.getByText(userText)).toBeVisible({ timeout: 30_000 })
      await expect(orcaPage.getByText(assistantText)).toBeVisible({ timeout: 30_000 })
      await expect(orcaPage.getByText(ERROR_TITLE)).toHaveCount(0)
      await orcaPage.screenshot({
        path: path.join(screenshotDir, '02-hydrated.png')
      })
    } finally {
      rmSync(scratchDir, { recursive: true, force: true })
    }
  })
})

test.describe('Native macOS Korean session chat @headful', () => {
  test.skip(
    process.platform !== 'darwin' || process.env.ORCA_E2E_NATIVE_MACOS_KOREAN !== '1',
    'Requires macOS with 2-Set Korean selected and Accessibility access'
  )

  test('keeps browser composition stable through streaming rerenders and owns only ordinary Enter', async ({
    electronApp,
    orcaPage,
    testRepoPath
  }, testInfo) => {
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)
    await ensureTerminalVisible(orcaPage)
    await waitForActiveTerminalManager(orcaPage, 30_000)
    await expect(orcaPage.evaluate(() => window.api.app.getKeyboardInputSourceId())).resolves.toBe(
      TWO_SET_KOREAN_ID
    )

    const descriptor = await waitForActivePaneHookDescriptor(orcaPage)
    const ptyId = await waitForActivePanePtyId(orcaPage)
    const byteReader = createTerminalImeByteReader(testRepoPath, 2)
    const [tabId] = descriptor.paneKey.split(':')
    const sessionId = `e2e-native-chat-ime-${randomUUID()}`
    const scratchDir = mkdtempSync(path.join(os.tmpdir(), 'orca-e2e-native-chat-ime-'))
    const transcriptPath = path.join(scratchDir, `${sessionId}.jsonl`)
    writeFileSync(
      transcriptPath,
      claudeTranscriptLines({
        sessionId,
        userText: 'Keep this session streaming',
        assistantText: 'Streaming response placeholder'
      })
    )

    try {
      await startTerminalImeByteReader(orcaPage, ptyId, byteReader)
      await enableNativeChatSetting(orcaPage)
      await seedClaudeProviderSession(orcaPage, {
        paneKey: descriptor.paneKey,
        worktreeId: descriptor.worktreeId,
        sessionId,
        transcriptPath
      })
      await toggleTerminalTabToChatView(orcaPage, { tabId, worktreeId: descriptor.worktreeId })

      const composer = orcaPage.locator('[data-native-chat-root="true"] textarea')
      await expect(composer).toBeVisible({ timeout: 15_000 })
      await composer.focus()
      await installNativeChatImeTrace(orcaPage)
      typeNativeKeys(electronApp.process().pid!, [7, 35, 17, 46, 7, 46])
      await expect.poll(() => composer.inputValue()).toBe('테스트')

      await orcaPage.waitForTimeout(1_500)
      await expect(composer).toHaveValue('테스트')
      typeNativeKeys(electronApp.process().pid!, [36])
      await expect(composer).toHaveValue('')

      await composer.fill('ordinary')
      await composer.press('Enter')
      const receivedBytes = await waitForTerminalImeBytes(orcaPage, byteReader)
      expect(receivedBytes).toEqual([
        Buffer.from('테스트\n').toString('hex'),
        Buffer.from('ordinary\n').toString('hex')
      ])
      const trace = await readNativeChatImeTrace(orcaPage)
      expect(trace.some((entry) => entry.type === 'compositionstart')).toBe(true)
      expect(trace.some((entry) => entry.type === 'compositionend')).toBe(true)
      expect(
        trace.some(
          (entry) =>
            entry.type === 'keydown' &&
            entry.key === 'Enter' &&
            entry.keyCode === 229 &&
            entry.isComposing === true
        )
      ).toBe(true)
      const evidencePath = testInfo.outputPath('native-macos-2set-session-chat.json')
      writeFileSync(
        evidencePath,
        JSON.stringify({ expectedText: '테스트', events: trace }, null, 2)
      )
      await testInfo.attach('native-macos-2set-session-chat.json', {
        path: evidencePath,
        contentType: 'application/json'
      })
    } finally {
      removeTerminalImeByteReader(byteReader)
      rmSync(scratchDir, { recursive: true, force: true })
    }
  })
})
