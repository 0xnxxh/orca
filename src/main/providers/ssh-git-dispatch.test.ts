import { afterEach, describe, expect, it } from 'vitest'
import {
  getSshGitProviderGeneration,
  registerSshGitProvider,
  subscribeSshGitProviderRegistry,
  unregisterSshGitProvider
} from './ssh-git-dispatch'

describe('SSH Git provider registry', () => {
  const connectionId = 'ssh-generation-test'

  afterEach(() => {
    unregisterSshGitProvider(connectionId)
  })

  it('keeps provider generations monotonic across unregister and re-register', () => {
    const before = getSshGitProviderGeneration(connectionId)
    registerSshGitProvider(connectionId, {} as never)
    const registered = getSshGitProviderGeneration(connectionId)
    unregisterSshGitProvider(connectionId)
    const unregistered = getSshGitProviderGeneration(connectionId)
    registerSshGitProvider(connectionId, {} as never)
    const reRegistered = getSshGitProviderGeneration(connectionId)

    expect(registered).toBe(before + 1)
    expect(unregistered).toBe(registered + 1)
    expect(reRegistered).toBe(unregistered + 1)
  })

  it('reports exact replacement generations until the listener unsubscribes', () => {
    const events: { generation: number; provider: unknown }[] = []
    const unsubscribe = subscribeSshGitProviderRegistry((event) => {
      if (event.connectionId === connectionId) {
        events.push({ generation: event.generation, provider: event.provider })
      }
    })
    const first = {} as never
    const second = {} as never

    registerSshGitProvider(connectionId, first)
    registerSshGitProvider(connectionId, second)
    unregisterSshGitProvider(connectionId)
    unsubscribe()
    registerSshGitProvider(connectionId, first)

    expect(events).toEqual([
      { generation: expect.any(Number), provider: first },
      { generation: expect.any(Number), provider: second },
      { generation: expect.any(Number), provider: undefined }
    ])
    expect(events[1].generation).toBe(events[0].generation + 1)
    expect(events[2].generation).toBe(events[1].generation + 1)
  })
})
