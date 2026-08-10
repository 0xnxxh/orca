// @vitest-environment happy-dom

import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CatalogModel } from '../../../../shared/agent-session-option-catalog'
import type { PersistedNativeChatSessionOptions } from '../../../../shared/native-chat-session-options'
import { toAppSshPtyId } from '../../../../shared/ssh-pty-id'
import { clearNativeChatModelEnrichmentForTests } from './native-chat-session-option-enrichment'
import {
  clearNativeChatSessionOptionCacheForTests,
  seedNativeChatAppliedSessionOptions
} from './native-chat-session-option-cache'

const discoverModels = vi.fn<() => Promise<readonly CatalogModel[] | null>>()
const updateSettings = vi.fn()
const storeState: {
  settings: { nativeChatSessionOptions?: PersistedNativeChatSessionOptions }
  updateSettings: typeof updateSettings
} = {
  settings: {},
  updateSettings
}

vi.mock('./native-chat-session-option-discovery', () => ({
  resolveNativeChatModelDiscoveryContext: () => ({ hostKey: 'host', runtime: null }),
  discoverNativeChatCatalogModels: () => discoverModels()
}))

vi.mock('../../store', () => ({
  useAppStore: Object.assign(() => undefined, {
    getState: () => storeState
  })
}))

import { useNativeChatSessionOptions } from './use-native-chat-session-options'

// A 1M-context Opus session: the frame names the resolved model while the
// host's discovered catalog names the alias.
const CLAUDE_SCREEN =
  'Claude Code v2.1.220\r\nOpus 5 (1M context) with high effort · API Usage Billing\r\n~/repo'

const DISCOVERED: CatalogModel[] = [
  { id: 'opus[1m]', label: 'Opus (1M context)', options: [] },
  { id: 'haiku', label: 'Haiku', options: [] }
]

function modelDescriptor(snapshot: { id: string; kind: unknown }[]): {
  currentValue?: string
  choices: { value: string }[]
} {
  const model = snapshot.find((descriptor) => descriptor.id === 'model')
  return model?.kind as { currentValue?: string; choices: { value: string }[] }
}

describe('useNativeChatSessionOptions model reporting', () => {
  beforeEach(() => {
    clearNativeChatModelEnrichmentForTests()
    clearNativeChatSessionOptionCacheForTests()
    discoverModels.mockReset()
    updateSettings.mockReset()
    updateSettings.mockImplementation(async ({ nativeChatSessionOptions }) => {
      storeState.settings = { nativeChatSessionOptions }
    })
    storeState.settings = {}
    Object.defineProperty(window, 'api', { configurable: true, value: undefined })
  })

  it('clears stale Codex flags on SSH/folders when older Codex or cancellation exposes no result', async () => {
    discoverModels.mockResolvedValue(null)
    storeState.settings = {
      nativeChatSessionOptions: {
        codex: {
          model: 'gpt-5.2-codex',
          valuesByModel: { 'gpt-5.2-codex': { effort: 'medium' } }
        }
      }
    }
    const dispatchCommand = vi.fn().mockResolvedValue(undefined)
    const onAgentPicker = vi.fn()
    seedNativeChatAppliedSessionOptions('folder-tab', 'codex', {
      model: 'gpt-5.2-codex',
      effort: 'medium'
    })
    const { result } = renderHook(() =>
      useNativeChatSessionOptions({
        agent: 'codex',
        terminalTabId: 'folder-tab',
        targetPtyId: toAppSshPtyId('host', 'pty-1'),
        dispatchCommand,
        onAgentPicker
      })
    )

    await result.current.surface?.invokeAction('effort')

    expect(dispatchCommand).toHaveBeenCalledWith('/model')
    expect(onAgentPicker).toHaveBeenCalledOnce()
    await waitFor(() => expect(updateSettings).toHaveBeenCalledOnce())
    expect(storeState.settings.nativeChatSessionOptions?.codex).toEqual({
      valuesByModel: { 'gpt-5.2-codex': { effort: 'medium' } }
    })
  })

  it('keeps explicit Orca model selections persistable after picker retirement', async () => {
    discoverModels.mockResolvedValue(null)
    storeState.settings = {
      nativeChatSessionOptions: {
        codex: {
          model: 'gpt-5.2-codex',
          valuesByModel: {
            'gpt-5.2-codex': { effort: 'medium' },
            'gpt-5.5': { effort: 'high' }
          }
        }
      }
    }
    const dispatchCommand = vi.fn()
    const { result } = renderHook(() =>
      useNativeChatSessionOptions({
        agent: 'codex',
        terminalTabId: 'tab-explicit',
        targetPtyId: 'pty-explicit',
        dispatchCommand
      })
    )

    result.current.surface?.recordOutgoingCommand('/model')
    await result.current.surface?.setOption('model', 'gpt-5.5')
    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(2))

    expect(dispatchCommand).toHaveBeenCalledWith('/model gpt-5.5')
    expect(storeState.settings.nativeChatSessionOptions?.codex?.model).toBe('gpt-5.5')
    expect(
      storeState.settings.nativeChatSessionOptions?.codex?.valuesByModel?.['gpt-5.5']?.effort
    ).toBe('high')
  })

  it('settles picker ownership before handing the pane to Codex', async () => {
    discoverModels.mockResolvedValue(null)
    storeState.settings = {
      nativeChatSessionOptions: { codex: { model: 'gpt-5.2-codex' } }
    }
    let settleWrite: (() => void) | undefined
    updateSettings.mockImplementation(
      ({ nativeChatSessionOptions }) =>
        new Promise<void>((resolve) => {
          settleWrite = () => {
            storeState.settings = { nativeChatSessionOptions }
            resolve()
          }
        })
    )
    const onAgentPicker = vi.fn()
    seedNativeChatAppliedSessionOptions('tab-ordered', 'codex', {
      model: 'gpt-5.2-codex',
      effort: 'medium'
    })
    const { result } = renderHook(() =>
      useNativeChatSessionOptions({
        agent: 'codex',
        terminalTabId: 'tab-ordered',
        targetPtyId: 'pty-ordered',
        dispatchCommand: vi.fn(),
        onAgentPicker
      })
    )

    const picker = result.current.surface?.invokeAction('effort')
    await waitFor(() => expect(updateSettings).toHaveBeenCalledOnce())

    expect(onAgentPicker).not.toHaveBeenCalled()
    settleWrite?.()
    await picker
    expect(onAgentPicker).toHaveBeenCalledOnce()
    expect(storeState.settings.nativeChatSessionOptions?.codex?.model).toBeUndefined()
  })

  it('keeps the override when Codex never accepts the picker command', async () => {
    discoverModels.mockResolvedValue(null)
    storeState.settings = {
      nativeChatSessionOptions: { codex: { model: 'gpt-5.2-codex' } }
    }
    const onAgentPicker = vi.fn()
    seedNativeChatAppliedSessionOptions('tab-rejected', 'codex', {
      model: 'gpt-5.2-codex',
      effort: 'medium'
    })
    const { result } = renderHook(() =>
      useNativeChatSessionOptions({
        agent: 'codex',
        terminalTabId: 'tab-rejected',
        targetPtyId: 'pty-rejected',
        dispatchCommand: vi.fn().mockRejectedValue(new Error('rejected')),
        onAgentPicker
      })
    )

    await expect(result.current.surface?.invokeAction('effort')).rejects.toThrow('rejected')
    expect(updateSettings).not.toHaveBeenCalled()
    expect(onAgentPicker).not.toHaveBeenCalled()
    expect(storeState.settings.nativeChatSessionOptions?.codex?.model).toBe('gpt-5.2-codex')
  })

  it('re-resolves the reported model against models discovered after the read', async () => {
    // Why: discovery is async, so the first scrape can only reach the seed. If
    // the reported id were left at the family the picker would show a row it
    // had to invent — and by then the frame may have scrolled out of the buffer,
    // so re-reading the screen is not an option.
    let resolveDiscovery: (models: CatalogModel[]) => void = () => {}
    discoverModels.mockReturnValue(
      new Promise<readonly CatalogModel[]>((resolve) => {
        resolveDiscovery = resolve
      })
    )

    // Stable identity, and the frame scrolls out of the buffer before discovery
    // lands — so nothing but the cached screen can drive the re-resolution.
    let frameVisible = true
    const readTerminalScreen = (): string | null =>
      frameVisible ? CLAUDE_SCREEN : 'conversation has scrolled past the frame'
    const dispatchCommand = vi.fn()

    const { result } = renderHook(() =>
      useNativeChatSessionOptions({
        agent: 'claude',
        terminalTabId: 'tab-1',
        targetPtyId: 'pty-1',
        dispatchCommand,
        readTerminalScreen
      })
    )

    await waitFor(() => expect(modelDescriptor(result.current.snapshot).currentValue).toBe('opus'))

    frameVisible = false
    resolveDiscovery(DISCOVERED)

    await waitFor(() =>
      expect(modelDescriptor(result.current.snapshot).currentValue).toBe('opus[1m]')
    )
    // The invented family row is gone: every choice is one the host listed.
    expect(modelDescriptor(result.current.snapshot).choices.map((choice) => choice.value)).toEqual([
      'opus[1m]',
      'haiku'
    ])
  })

  it('does not re-resolve a late snapshot from the previous pty', async () => {
    let resolveDiscovery: (models: CatalogModel[]) => void = () => {}
    discoverModels.mockReturnValue(
      new Promise<readonly CatalogModel[]>((resolve) => {
        resolveDiscovery = resolve
      })
    )
    let resolveOldSnapshot: (snapshot: { data: string; alternateScreen: false }) => void = () => {}
    const oldSnapshot = new Promise<{ data: string; alternateScreen: false }>((resolve) => {
      resolveOldSnapshot = resolve
    })
    const getMainBufferSnapshot = vi
      .fn()
      .mockReturnValueOnce(oldSnapshot)
      .mockReturnValueOnce(new Promise(() => {}))
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { pty: { getMainBufferSnapshot } }
    })

    const dispatchCommand = vi.fn()
    const { result, rerender } = renderHook(
      ({ targetPtyId }) =>
        useNativeChatSessionOptions({
          agent: 'claude',
          terminalTabId: 'tab-1',
          targetPtyId,
          dispatchCommand,
          readTerminalScreen: () => null
        }),
      { initialProps: { targetPtyId: 'pty-old' } }
    )

    rerender({ targetPtyId: 'pty-new' })
    resolveOldSnapshot({ data: CLAUDE_SCREEN, alternateScreen: false })
    await Promise.resolve()
    resolveDiscovery(DISCOVERED)

    await waitFor(() =>
      expect(
        modelDescriptor(result.current.snapshot).choices.map((choice) => choice.value)
      ).toEqual(['opus[1m]', 'haiku'])
    )
    expect(modelDescriptor(result.current.snapshot).currentValue).toBeUndefined()
  })

  it('clears a previously reported screen when the target pty changes', async () => {
    let resolveDiscovery: (models: CatalogModel[]) => void = () => {}
    discoverModels.mockReturnValue(
      new Promise<readonly CatalogModel[]>((resolve) => {
        resolveDiscovery = resolve
      })
    )
    const getMainBufferSnapshot = vi
      .fn()
      .mockResolvedValueOnce({ data: CLAUDE_SCREEN, alternateScreen: false })
      .mockReturnValueOnce(new Promise(() => {}))
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { pty: { getMainBufferSnapshot } }
    })

    const dispatchCommand = vi.fn()
    const { result, rerender } = renderHook(
      ({ targetPtyId }) =>
        useNativeChatSessionOptions({
          agent: 'claude',
          terminalTabId: 'tab-reset',
          targetPtyId,
          dispatchCommand,
          readTerminalScreen: () => null
        }),
      { initialProps: { targetPtyId: 'pty-reported' } }
    )
    await waitFor(() => expect(modelDescriptor(result.current.snapshot).currentValue).toBe('opus'))

    rerender({ targetPtyId: 'pty-empty' })
    resolveDiscovery(DISCOVERED)

    await waitFor(() =>
      expect(
        modelDescriptor(result.current.snapshot).choices.map((choice) => choice.value)
      ).toEqual(['opus[1m]', 'haiku'])
    )
    expect(modelDescriptor(result.current.snapshot).currentValue).toBeUndefined()
  })
})
