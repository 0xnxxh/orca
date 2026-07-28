import { describe, expect, it, vi } from 'vitest'
import type {
  PtySourceDeliveryIdentity,
  PtySourceSpan
} from '../../shared/pty-source-credit-contract'
import type { TerminalOutputSourceRange } from '../../shared/terminal-output-source-range'
import { SshPtyRemoteSourceRangeConsumers } from './ssh-pty-remote-source-range-consumers'
import { SshPtySourceObligationCoordinator } from './ssh-pty-source-obligation-coordinator'

const identity: PtySourceDeliveryIdentity = {
  id: 'pty-1',
  providerGeneration: 1,
  clientGeneration: 2,
  ownerGeneration: 3,
  ptyIncarnation: 'incarnation-1',
  deliveryToken: 'token-1'
}

function span(spanId: string): PtySourceSpan {
  return {
    ...identity,
    spanId,
    sourceStartSu: 0,
    sourceEndSu: 4,
    displayStart: 0,
    displayEnd: 4,
    data: 'data',
    splittable: true,
    transform: { transformed: false, rawLengthSu: 4, scalarSafe: true }
  }
}

function range(
  spanId: string,
  overrides: Partial<TerminalOutputSourceRange> = {}
): TerminalOutputSourceRange {
  return {
    id: 'pty-1',
    spanId,
    providerGeneration: 1,
    clientGeneration: 2,
    ownerGeneration: 3,
    ptyIncarnation: 'incarnation-1',
    deliveryToken: 'token-1',
    sourceStartSu: 0,
    sourceEndSu: 4,
    displayStart: 0,
    displayEnd: 4,
    splittable: true,
    transform: { transformed: false, rawLengthSu: 4, scalarSafe: true },
    ...overrides
  }
}

function createCoordinator(): SshPtySourceObligationCoordinator {
  return new SshPtySourceObligationCoordinator({
    publish: vi.fn(),
    schedule: vi.fn(() => 1 as unknown as ReturnType<typeof setTimeout>),
    cancelSchedule: vi.fn()
  })
}

describe('SshPtyRemoteSourceRangeConsumers', () => {
  it('snapshots membership and settles only the current stream generation', () => {
    const ledger = createCoordinator()
    const progress = vi.fn()
    const consumers = new SshPtyRemoteSourceRangeConsumers(ledger, progress)
    const stream = { ptyId: 'pty-1', consumerId: 'consumer-1', streamGeneration: 'stream-1' }
    ledger.open(identity)
    expect(consumers.hooks.attach(stream)).toBe(true)
    const sourceSpan = span('span-1')
    const reservation = ledger.reserve(identity, sourceSpan, [
      'model',
      ...consumers.requiredConsumers('pty-1')
    ])
    ledger.commit(reservation)
    consumers.trackSpan('pty-1', sourceSpan.spanId, reservation.requiredConsumers)

    consumers.hooks.settle({ ...stream, streamGeneration: 'stale' }, [range('span-1')])
    expect(ledger.obligation('span-1', 'remote:consumer-1').state).toBe('open')
    consumers.hooks.settle(stream, [range('span-1')])
    expect(ledger.obligation('span-1', 'remote:consumer-1').state).toBe('settled')
    expect(progress).toHaveBeenCalledTimes(1)
  })

  it('atomically transfers remaining mappings on explicit detach', () => {
    const ledger = createCoordinator()
    const consumers = new SshPtyRemoteSourceRangeConsumers(ledger)
    const stream = { ptyId: 'pty-1', consumerId: 'consumer-1', streamGeneration: 'stream-1' }
    ledger.open(identity)
    consumers.hooks.attach(stream)
    const reservation = ledger.reserve(identity, span('span-1'), [
      'model',
      ...consumers.requiredConsumers('pty-1')
    ])
    ledger.commit(reservation)
    consumers.trackSpan('pty-1', 'span-1', reservation.requiredConsumers)

    consumers.hooks.transfer(stream, [range('span-1')], 'stream-detached')

    expect(ledger.obligation('span-1', 'remote:consumer-1')).toMatchObject({
      state: 'transferred',
      to: 'remote:snapshot:consumer-1'
    })
    expect(consumers.requiredConsumers('pty-1')).toEqual([])
  })

  it('settles a split source span only after its complete ordered range is acknowledged', () => {
    const ledger = createCoordinator()
    const consumers = new SshPtyRemoteSourceRangeConsumers(ledger)
    const stream = { ptyId: 'pty-1', consumerId: 'consumer-1', streamGeneration: 'stream-1' }
    ledger.open(identity)
    consumers.hooks.attach(stream)
    const reservation = ledger.reserve(identity, span('span-1'), [
      'model',
      ...consumers.requiredConsumers('pty-1')
    ])
    ledger.commit(reservation)
    consumers.trackSpan('pty-1', 'span-1', reservation.requiredConsumers)

    consumers.hooks.settle(stream, [
      range('span-1', {
        sourceEndSu: 2,
        displayEnd: 2,
        transform: { transformed: false, rawLengthSu: 2, scalarSafe: true }
      })
    ])
    expect(ledger.obligation('span-1', 'remote:consumer-1').state).toBe('open')

    consumers.hooks.settle(stream, [
      range('span-1', {
        sourceStartSu: 2,
        sourceEndSu: 4,
        displayStart: 2,
        displayEnd: 4,
        transform: { transformed: false, rawLengthSu: 2, scalarSafe: true }
      })
    ])
    expect(ledger.obligation('span-1', 'remote:consumer-1').state).toBe('settled')
  })

  it('transfers an admitted span even when no encoded mapping was sent', () => {
    const ledger = createCoordinator()
    const consumers = new SshPtyRemoteSourceRangeConsumers(ledger)
    const stream = { ptyId: 'pty-1', consumerId: 'consumer-1', streamGeneration: 'stream-1' }
    ledger.open(identity)
    consumers.hooks.attach(stream)
    const reservation = ledger.reserve(identity, span('span-1'), [
      'model',
      ...consumers.requiredConsumers('pty-1')
    ])
    ledger.commit(reservation)
    consumers.trackSpan('pty-1', 'span-1', reservation.requiredConsumers)

    consumers.hooks.transfer(stream, [], 'stream-detached')

    expect(ledger.obligation('span-1', 'remote:consumer-1')).toMatchObject({
      state: 'transferred'
    })
  })
})
