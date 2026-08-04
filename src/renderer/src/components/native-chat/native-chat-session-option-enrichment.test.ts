import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CatalogModel } from '../../../../shared/agent-session-option-catalog'
import {
  clearNativeChatModelEnrichmentForTests,
  ensureNativeChatModelEnrichment,
  readNativeChatEnrichedModels,
  subscribeNativeChatEnrichedModels
} from './native-chat-session-option-enrichment'

describe('native chat session option enrichment', () => {
  beforeEach(() => clearNativeChatModelEnrichmentForTests())

  it('keeps reads synchronous while one host-scoped probe is in flight', async () => {
    let resolveDiscovery: ((models: CatalogModel[]) => void) | undefined
    const discover = vi.fn(
      () =>
        new Promise<CatalogModel[]>((resolve) => {
          resolveDiscovery = resolve
        })
    )
    const listener = vi.fn()
    subscribeNativeChatEnrichedModels('cursor', 'ssh:one', listener)

    ensureNativeChatModelEnrichment({ agent: 'cursor', hostKey: 'ssh:one', discover })
    ensureNativeChatModelEnrichment({ agent: 'cursor', hostKey: 'ssh:one', discover })

    expect(readNativeChatEnrichedModels('cursor', 'ssh:one')).toBeNull()
    expect(discover).toHaveBeenCalledOnce()

    resolveDiscovery?.([
      { id: 'gpt-5.3-codex', label: 'GPT 5.3 live', options: [] },
      { id: 'account-model', label: 'Account model', options: [] }
    ])
    await vi.waitFor(() => expect(listener).toHaveBeenCalledOnce())

    const models = readNativeChatEnrichedModels('cursor', 'ssh:one')!
    expect(models.find((model) => model.id === 'gpt-5.3-codex')).toMatchObject({
      label: 'GPT 5.3 live',
      options: expect.arrayContaining([expect.objectContaining({ id: 'effort' })])
    })
    expect(models.at(-1)).toMatchObject({ id: 'account-model' })
    expect(readNativeChatEnrichedModels('cursor', 'ssh:two')).toBeNull()
  })

  it('falls back permanently to the seed after a failed once-per-host probe', async () => {
    const discover = vi.fn().mockRejectedValue(new Error('offline'))
    ensureNativeChatModelEnrichment({ agent: 'cursor', hostKey: 'local', discover })
    await vi.waitFor(() => expect(discover).toHaveBeenCalledOnce())
    await Promise.resolve()

    ensureNativeChatModelEnrichment({ agent: 'cursor', hostKey: 'local', discover })
    expect(discover).toHaveBeenCalledOnce()
    expect(readNativeChatEnrichedModels('cursor', 'local')).toBeNull()
  })

  it('does not probe agents whose catalogs have no discovery command', () => {
    const discover = vi.fn()
    ensureNativeChatModelEnrichment({ agent: 'gemini', hostKey: 'local', discover })
    expect(discover).not.toHaveBeenCalled()
  })

  it('overlays discovered Claude variants on the alias seed per host', async () => {
    const discover = vi.fn().mockResolvedValue([
      {
        id: 'opus[1m]',
        label: 'Opus (1M context)',
        description: 'Opus 5 with 1M context',
        options: []
      },
      { id: 'sonnet', label: 'Sonnet', options: [] }
    ] satisfies CatalogModel[])
    const listener = vi.fn()
    subscribeNativeChatEnrichedModels('claude', 'ssh:host', listener)

    ensureNativeChatModelEnrichment({ agent: 'claude', hostKey: 'ssh:host', discover })
    await vi.waitFor(() => expect(listener).toHaveBeenCalledOnce())

    const models = readNativeChatEnrichedModels('claude', 'ssh:host')!
    expect(models.map(({ id }) => id)).toEqual(['fable', 'opus', 'sonnet', 'haiku', 'opus[1m]'])
    // Why: matched seed entries must keep their cataloged effort/fast options.
    expect(models.find(({ id }) => id === 'sonnet')?.options.map(({ id }) => id)).toEqual([
      'effort'
    ])
    expect(models.at(-1)).toMatchObject({
      id: 'opus[1m]',
      description: 'Opus 5 with 1M context'
    })
    expect(readNativeChatEnrichedModels('claude', 'local')).toBeNull()
  })
})
