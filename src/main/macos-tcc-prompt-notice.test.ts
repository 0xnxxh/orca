import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as NodeFs from 'node:fs'

const writeFileAtomically = vi.fn()
const watchStart = vi.fn()
const watchStop = vi.fn()
const watchOptions: { onPrompt: () => void }[] = []
vi.mock('./codex-accounts/fs-utils', () => ({
  writeFileAtomically: (...args: unknown[]) => writeFileAtomically(...args)
}))
vi.mock('./persistence', () => ({ getCanonicalUserDataPath: () => '/tmp/orca-tcc-notice-test' }))
vi.mock('./macos-tcc-prompt-watch', () => ({
  MacosTccPromptWatch: class {
    constructor(options: { onPrompt: () => void }) {
      watchOptions.push(options)
    }
    start(): void {
      watchStart()
    }
    stop(): void {
      watchStop()
    }
  }
}))
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof NodeFs>()),
  readFileSync: () => {
    throw new Error('ENOENT')
  }
}))

const {
  TCC_PROMPT_NOTICE_THRESHOLD,
  dismissTccPromptNotice,
  handleTccPromptForTests,
  initTccPromptNotice,
  resetTccPromptNoticeForTests
} = await import('./macos-tcc-prompt-notice')

beforeEach(() => {
  resetTccPromptNoticeForTests()
  watchOptions.length = 0
  watchStart.mockClear()
  watchStop.mockClear()
  writeFileAtomically.mockClear()
})

describe('tcc prompt notice threshold', () => {
  it('stays silent until the third dialog, then fires exactly once', () => {
    expect(handleTccPromptForTests()).toBeNull()
    expect(handleTccPromptForTests()).toBeNull()

    const payload = handleTccPromptForTests()
    expect(payload).toEqual({
      promptCount: TCC_PROMPT_NOTICE_THRESHOLD
    })

    // Why: a recurring prompt loop must not produce a toast per dialog.
    expect(handleTccPromptForTests()).toBeNull()
    expect(handleTccPromptForTests()).toBeNull()
  })

  it('persists the tally on every prompt so the count survives relaunch', () => {
    handleTccPromptForTests()
    expect(writeFileAtomically).toHaveBeenCalledTimes(1)
    const [, contents] = writeFileAtomically.mock.calls[0] as [string, string]
    expect(JSON.parse(contents)).toMatchObject({ promptCount: 1, notified: false })
  })

  it('never fires again once dismissed, even past the threshold', () => {
    dismissTccPromptNotice()
    for (let i = 0; i < TCC_PROMPT_NOTICE_THRESHOLD + 2; i += 1) {
      expect(handleTccPromptForTests()).toBeNull()
    }
  })

  it('stops tally writes after the one-time notice fires', () => {
    for (let i = 0; i < TCC_PROMPT_NOTICE_THRESHOLD; i += 1) {
      handleTccPromptForTests()
    }
    writeFileAtomically.mockClear()

    expect(handleTccPromptForTests()).toBeNull()
    expect(writeFileAtomically).not.toHaveBeenCalled()
  })

  it('routes a later prompt to the replacement main window', () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' })
    const oldWindow = createWindowStub()
    const newWindow = createWindowStub()
    try {
      initTccPromptNotice(oldWindow as never)
      initTccPromptNotice(newWindow as never)
      for (let i = 0; i < TCC_PROMPT_NOTICE_THRESHOLD; i += 1) {
        watchOptions[0].onPrompt()
      }
      expect(oldWindow.webContents.send).not.toHaveBeenCalled()
      expect(newWindow.webContents.send).toHaveBeenCalledTimes(1)
      expect(watchStop).toHaveBeenCalledTimes(1)
    } finally {
      Object.defineProperty(process, 'platform', platform!)
    }
  })

  it('does not send through a destroyed main window', () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' })
    const mainWindow = createWindowStub()
    mainWindow.isDestroyed.mockReturnValue(true)
    try {
      initTccPromptNotice(mainWindow as never)
      expect(() => {
        for (let i = 0; i < TCC_PROMPT_NOTICE_THRESHOLD; i += 1) {
          watchOptions[0].onPrompt()
        }
      }).not.toThrow()
      expect(mainWindow.webContents.send).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(process, 'platform', platform!)
    }
  })
})

function createWindowStub() {
  return {
    isDestroyed: vi.fn(() => false),
    webContents: {
      isDestroyed: vi.fn(() => false),
      send: vi.fn()
    }
  }
}
