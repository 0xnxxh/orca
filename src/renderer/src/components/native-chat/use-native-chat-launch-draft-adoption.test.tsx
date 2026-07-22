// @vitest-environment happy-dom

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatLaunchDraft } from '@/lib/native-chat-launch-prompt'
import { useNativeChatLaunchDraftAdoption } from './use-native-chat-launch-draft-adoption'

const mocks = vi.hoisted(() => ({
  markNativeChatLaunchDraftAdopted: vi.fn(),
  clearNativeChatLaunchDraft: vi.fn()
}))

vi.mock('../../store', () => ({
  useAppStore: {
    getState: () => ({
      markNativeChatLaunchDraftAdopted: mocks.markNativeChatLaunchDraftAdopted,
      clearNativeChatLaunchDraft: mocks.clearNativeChatLaunchDraft
    })
  }
}))

function launchDraft(overrides: Partial<NativeChatLaunchDraft> = {}): NativeChatLaunchDraft {
  return {
    tabId: 'tab-1',
    agent: 'claude',
    text: 'https://github.com/o/r/issues/12',
    createdAt: 1000,
    ...overrides
  }
}

function setup(args: {
  launchDraft: NativeChatLaunchDraft | null
  launchDraftResolved?: boolean
  draft?: string
  agent?: string
}): { setDraft: ReturnType<typeof vi.fn>; setCaret: ReturnType<typeof vi.fn> } {
  const setDraft = vi.fn()
  const setCaret = vi.fn()
  renderHook(() =>
    useNativeChatLaunchDraftAdoption({
      terminalTabId: 'tab-1',
      agent: args.agent ?? 'claude',
      launchDraft: args.launchDraft,
      launchDraftResolved: args.launchDraftResolved ?? false,
      draft: args.draft ?? '',
      setDraft,
      setCaret
    })
  )
  return { setDraft, setCaret }
}

describe('useNativeChatLaunchDraftAdoption', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('adopts an unadopted seed into an empty composer', () => {
    const entry = launchDraft()
    const { setDraft, setCaret } = setup({ launchDraft: entry })

    expect(mocks.markNativeChatLaunchDraftAdopted).toHaveBeenCalledWith('tab-1')
    expect(setDraft).toHaveBeenCalledWith(entry.text)
    expect(setCaret).toHaveBeenCalledWith(entry.text.length)
    expect(mocks.clearNativeChatLaunchDraft).not.toHaveBeenCalled()
  })

  it('declines the seed permanently when the composer already holds text', () => {
    const { setDraft } = setup({ launchDraft: launchDraft(), draft: 'user typed first' })

    expect(mocks.markNativeChatLaunchDraftAdopted).toHaveBeenCalledWith('tab-1')
    expect(setDraft).not.toHaveBeenCalled()
  })

  it('does nothing for a different agent or a missing seed', () => {
    setup({ launchDraft: launchDraft({ agent: 'codex' }) })
    setup({ launchDraft: null })

    expect(mocks.markNativeChatLaunchDraftAdopted).not.toHaveBeenCalled()
    expect(mocks.clearNativeChatLaunchDraft).not.toHaveBeenCalled()
  })

  it('does not re-adopt an already adopted seed after the user clears the composer', () => {
    const { setDraft } = setup({ launchDraft: launchDraft({ adopted: true }), draft: '' })

    expect(setDraft).not.toHaveBeenCalled()
    expect(mocks.markNativeChatLaunchDraftAdopted).not.toHaveBeenCalled()
  })

  it('clears an untouched adopted copy once the transcript resolves the draft', () => {
    const entry = launchDraft({ adopted: true })
    const { setDraft, setCaret } = setup({
      launchDraft: entry,
      launchDraftResolved: true,
      draft: entry.text
    })

    expect(setDraft).toHaveBeenCalledWith('')
    expect(setCaret).toHaveBeenCalledWith(0)
    expect(mocks.clearNativeChatLaunchDraft).toHaveBeenCalledWith('tab-1')
  })

  it('keeps user edits when the transcript resolves the draft', () => {
    const { setDraft } = setup({
      launchDraft: launchDraft({ adopted: true }),
      launchDraftResolved: true,
      draft: 'edited context'
    })

    expect(setDraft).not.toHaveBeenCalled()
    expect(mocks.clearNativeChatLaunchDraft).toHaveBeenCalledWith('tab-1')
  })

  it('drops an unadopted seed once the transcript resolves it', () => {
    const { setDraft } = setup({ launchDraft: launchDraft(), launchDraftResolved: true })

    expect(setDraft).not.toHaveBeenCalled()
    expect(mocks.markNativeChatLaunchDraftAdopted).not.toHaveBeenCalled()
    expect(mocks.clearNativeChatLaunchDraft).toHaveBeenCalledWith('tab-1')
  })
})
