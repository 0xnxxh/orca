import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { writeFileAtomically } from './codex-accounts/fs-utils'
import { getCanonicalUserDataPath } from './persistence'
import { MacosTccPromptWatch, type TccPromptEvent } from './macos-tcc-prompt-watch'

/**
 * Surfaces Full Disk Access guidance only to users macOS is actually prompting
 * (#9756), instead of nudging every Mac user. Counts Orca-attributed TCC
 * dialogs across launches and tells the renderer once the third one lands.
 */

/** Why: one dialog is normal and two is bad luck; three means it is recurring for this user. */
export const TCC_PROMPT_NOTICE_THRESHOLD = 3

export const TCC_PROMPT_NOTICE_CHANNEL = 'macosTccPrompts:threshold'

export type TccPromptNoticePayload = {
  promptCount: number
  /** Binary that triggered the most recent dialog, so the notice can name it. */
  accessingBinaryName?: string
}

type TccPromptTally = {
  promptCount: number
  notified: boolean
  dismissed: boolean
}

const EMPTY_TALLY: TccPromptTally = { promptCount: 0, notified: false, dismissed: false }

let tally: TccPromptTally = { ...EMPTY_TALLY }
let mainWindowRef: BrowserWindow | null = null
let watch: MacosTccPromptWatch | null = null

function tallyPath(): string {
  return join(getCanonicalUserDataPath(), 'macos-tcc-prompt-tally.json')
}

function loadTally(): TccPromptTally {
  try {
    const parsed = JSON.parse(readFileSync(tallyPath(), 'utf-8')) as Partial<TccPromptTally>
    return {
      promptCount: typeof parsed.promptCount === 'number' ? parsed.promptCount : 0,
      notified: parsed.notified === true,
      dismissed: parsed.dismissed === true
    }
  } catch {
    return { ...EMPTY_TALLY }
  }
}

function saveTally(): void {
  try {
    writeFileAtomically(tallyPath(), `${JSON.stringify(tally, null, 2)}\n`)
  } catch {
    // Best-effort: losing the count only means the notice arrives a launch later.
  }
}

/** Exported for tests: the binary name is all the notice shows, never the full path. */
export function describeAccessingBinary(event: TccPromptEvent): string | undefined {
  const path = event.binaryPath
  if (!path) {
    return undefined
  }
  // Why: basename('/') returns '/', which is not a binary name worth showing.
  const name = basename(path)
  return name && name !== '/' ? name : undefined
}

export function handleTccPromptForTests(event: TccPromptEvent): TccPromptNoticePayload | null {
  return recordPrompt(event)
}

function recordPrompt(event: TccPromptEvent): TccPromptNoticePayload | null {
  if (tally.dismissed) {
    return null
  }
  tally = { ...tally, promptCount: tally.promptCount + 1 }
  const shouldNotify = !tally.notified && tally.promptCount >= TCC_PROMPT_NOTICE_THRESHOLD
  if (shouldNotify) {
    tally = { ...tally, notified: true }
  }
  saveTally()
  if (!shouldNotify) {
    return null
  }
  const accessingBinaryName = describeAccessingBinary(event)
  return {
    promptCount: tally.promptCount,
    ...(accessingBinaryName ? { accessingBinaryName } : {})
  }
}

/** Permanently stops the notice for this user; the watcher shuts down with it. */
export function dismissTccPromptNotice(): void {
  tally = { ...tally, dismissed: true, notified: true }
  saveTally()
  stopTccPromptNotice()
}

export function initTccPromptNotice(mainWindow: BrowserWindow): void {
  if (process.platform !== 'darwin' || watch) {
    return
  }
  mainWindowRef = mainWindow
  tally = loadTally()
  if (tally.dismissed) {
    return
  }
  watch = new MacosTccPromptWatch({
    onPrompt: (event) => {
      const payload = recordPrompt(event)
      if (payload) {
        mainWindowRef?.webContents.send(TCC_PROMPT_NOTICE_CHANNEL, payload)
      }
    }
  })
  watch.start()
}

export function stopTccPromptNotice(): void {
  watch?.stop()
  watch = null
  mainWindowRef = null
}

export function resetTccPromptNoticeForTests(): void {
  tally = { ...EMPTY_TALLY }
  watch = null
  mainWindowRef = null
}
