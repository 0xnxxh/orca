import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as NodeFs from 'node:fs'

const writeFileAtomically = vi.fn()
vi.mock('./codex-accounts/fs-utils', () => ({
  writeFileAtomically: (...args: unknown[]) => writeFileAtomically(...args)
}))
vi.mock('./persistence', () => ({ getCanonicalUserDataPath: () => '/tmp/orca-tcc-notice-test' }))
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
  resetTccPromptNoticeForTests
} = await import('./macos-tcc-prompt-notice')

beforeEach(() => {
  resetTccPromptNoticeForTests()
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
})
