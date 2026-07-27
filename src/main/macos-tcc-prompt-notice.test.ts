import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as NodeFs from 'node:fs'
import type { TccPromptEvent } from './macos-tcc-prompt-watch'

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
  describeAccessingBinary,
  dismissTccPromptNotice,
  handleTccPromptForTests,
  resetTccPromptNoticeForTests
} = await import('./macos-tcc-prompt-notice')

function promptEvent(overrides: Partial<TccPromptEvent> = {}): TccPromptEvent {
  return {
    service: 'kTCCServiceSystemPolicyAppData',
    accessingIdentifier: 'node-5555494487fbc7467d473fd8b0a397018cbf954b',
    responsibleIdentifier: 'com.stablyai.orca',
    binaryPath: '/opt/homebrew/Cellar/node/26.5.0/bin/node',
    ...overrides
  }
}

beforeEach(() => {
  resetTccPromptNoticeForTests()
  writeFileAtomically.mockClear()
})

describe('tcc prompt notice threshold', () => {
  it('stays silent until the third dialog, then fires exactly once', () => {
    expect(handleTccPromptForTests(promptEvent())).toBeNull()
    expect(handleTccPromptForTests(promptEvent())).toBeNull()

    const payload = handleTccPromptForTests(promptEvent())
    expect(payload).toEqual({
      promptCount: TCC_PROMPT_NOTICE_THRESHOLD,
      accessingBinaryName: 'node'
    })

    // Why: a recurring prompt loop must not produce a toast per dialog.
    expect(handleTccPromptForTests(promptEvent())).toBeNull()
    expect(handleTccPromptForTests(promptEvent())).toBeNull()
  })

  it('persists the tally on every prompt so the count survives relaunch', () => {
    handleTccPromptForTests(promptEvent())
    expect(writeFileAtomically).toHaveBeenCalledTimes(1)
    const [, contents] = writeFileAtomically.mock.calls[0] as [string, string]
    expect(JSON.parse(contents)).toMatchObject({ promptCount: 1, notified: false })
  })

  it('never fires again once dismissed, even past the threshold', () => {
    dismissTccPromptNotice()
    for (let i = 0; i < TCC_PROMPT_NOTICE_THRESHOLD + 2; i += 1) {
      expect(handleTccPromptForTests(promptEvent())).toBeNull()
    }
  })

  it('omits the binary name when tccd reported no path', () => {
    handleTccPromptForTests(promptEvent({ binaryPath: undefined }))
    handleTccPromptForTests(promptEvent({ binaryPath: undefined }))
    expect(handleTccPromptForTests(promptEvent({ binaryPath: undefined }))).toEqual({
      promptCount: TCC_PROMPT_NOTICE_THRESHOLD
    })
  })
})

describe('describeAccessingBinary', () => {
  it('reduces a path to its binary name and never leaks the directory', () => {
    expect(describeAccessingBinary(promptEvent())).toBe('node')
    expect(
      describeAccessingBinary(promptEvent({ binaryPath: '/Users/someone/.local/bin/codex' }))
    ).toBe('codex')
  })

  it('returns undefined for a missing or unusable path', () => {
    expect(describeAccessingBinary(promptEvent({ binaryPath: undefined }))).toBeUndefined()
    expect(describeAccessingBinary(promptEvent({ binaryPath: '/' }))).toBeUndefined()
  })
})
