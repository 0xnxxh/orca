import { describe, expect, it, vi } from 'vitest'
import type {
  TerminalAuthorityAppOutcomeHostConnection,
  TerminalAuthorityAppOutcomeHostTransport
} from './terminal-authority-app-outcome-host-contract'
import { TerminalAuthorityAppOutcomeHostTransportSlot } from './terminal-authority-app-outcome-host-transport-slot'

const HOST = 'authority-host-a'

describe('TerminalAuthorityAppOutcomeHostTransportSlot', () => {
  it('keeps an incumbent source current until the standby is explicitly selected', async () => {
    const first = transport('first')
    const second = transport('second')
    const slot = new TerminalAuthorityAppOutcomeHostTransportSlot(HOST)
    const firstLease = slot.install(first.transport)
    const onFirstFailure = vi.fn()
    const firstConnection = await slot.connect({ onFailure: onFirstFailure })

    const secondLease = slot.install(second.transport)

    expect(onFirstFailure).not.toHaveBeenCalled()
    expect(first.disconnect).not.toHaveBeenCalled()
    expect(firstLease.isActive()).toBe(true)
    expect(firstLease.isCurrent()).toBe(true)
    expect(secondLease.isCurrent()).toBe(false)

    await secondLease.withCurrent(async (binding) => {
      const secondConnection = await slot.connect({ onFailure: vi.fn() })
      binding.bindConnectionGeneration()
      await expect(secondConnection.resolveNamespace('repo::/workspace')).resolves.toEqual({
        authorityHostId: HOST,
        namespaceId: 'second'
      })
    })

    expect(onFirstFailure).toHaveBeenCalledOnce()
    expect(first.disconnect).toHaveBeenCalledOnce()
    expect(firstLease.isCurrent()).toBe(false)
    expect(secondLease.isCurrent()).toBe(true)

    firstConnection.disconnect()
    secondLease.dispose()
    expect(second.disconnect).toHaveBeenCalledOnce()
  })

  it('requires explicit selection after the current source disconnects', async () => {
    const first = transport('first')
    const second = transport('second')
    const slot = new TerminalAuthorityAppOutcomeHostTransportSlot(HOST)
    const firstLease = slot.install(first.transport)
    await slot.connect({ onFailure: vi.fn() })
    const secondLease = slot.install(second.transport)
    firstLease.dispose()

    expect(secondLease.isActive()).toBe(true)
    expect(secondLease.isCurrent()).toBe(false)
    await expect(slot.connect({ onFailure: vi.fn() })).rejects.toThrow('unavailable')
    await secondLease.withCurrent(async (binding) => {
      const selected = await slot.connect({ onFailure: vi.fn() })
      binding.bindConnectionGeneration()
      await expect(selected.resolveNamespace('repo::/workspace')).resolves.toEqual({
        authorityHostId: HOST,
        namespaceId: 'second'
      })
    })
  })

  it('rejects a pending stale connection and disconnects its late result', async () => {
    let resolveFirst!: (connection: TerminalAuthorityAppOutcomeHostConnection) => void
    const lateConnection = connection('late')
    const first: TerminalAuthorityAppOutcomeHostTransport = {
      authenticatedAuthorityHostId: HOST,
      connect: () =>
        new Promise<TerminalAuthorityAppOutcomeHostConnection>((resolve) => {
          resolveFirst = resolve
        })
    }
    const slot = new TerminalAuthorityAppOutcomeHostTransportSlot(HOST)
    const firstLease = slot.install(first)
    const pending = slot.connect({ onFailure: vi.fn() })

    slot.install(transport('current').transport)
    firstLease.dispose()
    await expect(pending).rejects.toThrow('disconnected')
    resolveFirst(lateConnection.value)
    await vi.waitFor(() => expect(lateConnection.disconnect).toHaveBeenCalledOnce())
  })

  it('does not switch sources until every operation on the current source settles', async () => {
    const first = transport('first')
    const second = transport('second')
    const slot = new TerminalAuthorityAppOutcomeHostTransportSlot(HOST)
    const firstLease = slot.install(first.transport)
    const secondLease = slot.install(second.transport)
    let releaseFirst!: () => void
    const held = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const order: string[] = []

    const firstOperation = firstLease.withCurrent(async (binding) => {
      await slot.connect({ onFailure: vi.fn() })
      binding.bindConnectionGeneration()
      order.push('first-start')
      await held
      binding.assertCurrent()
      order.push('first-end')
    })
    await vi.waitFor(() => expect(order).toEqual(['first-start']))
    const secondOperation = secondLease.withCurrent(async (binding) => {
      await slot.connect({ onFailure: vi.fn() })
      binding.bindConnectionGeneration()
      order.push('second')
    })
    await Promise.resolve()
    expect(second.transport.connect).not.toHaveBeenCalled()

    releaseFirst()
    await Promise.all([firstOperation, secondOperation])
    expect(order).toEqual(['first-start', 'first-end', 'second'])
  })
})

function transport(namespaceId: string) {
  const created = connection(namespaceId)
  return {
    transport: {
      authenticatedAuthorityHostId: HOST,
      connect: vi.fn(async () => created.value)
    } satisfies TerminalAuthorityAppOutcomeHostTransport,
    disconnect: created.disconnect
  }
}

function connection(namespaceId: string) {
  const disconnect = vi.fn()
  return {
    value: {
      authenticatedAuthorityHostId: HOST,
      resolveNamespace: async () => ({ authorityHostId: HOST, namespaceId }),
      openNamespace: vi.fn(),
      retireNamespace: vi.fn(),
      disconnect
    } as TerminalAuthorityAppOutcomeHostConnection,
    disconnect
  }
}
