// @vitest-environment happy-dom

import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CatalogModel } from '../../../../shared/agent-session-option-catalog'

const discoverModels = vi.fn<() => Promise<readonly CatalogModel[] | null>>()

vi.mock('./native-chat-session-option-discovery', () => ({
  resolveNativeChatModelDiscoveryContext: () => ({ hostKey: 'host', runtime: null }),
  discoverNativeChatCatalogModels: () => discoverModels()
}))

vi.mock('../../store', () => ({
  useAppStore: Object.assign(() => undefined, {
    getState: () => ({ settings: {}, updateSettings: async () => undefined })
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
    vi.resetModules()
    discoverModels.mockReset()
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
})
