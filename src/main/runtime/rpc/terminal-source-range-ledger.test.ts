import { describe, expect, it } from 'vitest'
import type { TerminalOutputSourceRange } from '../../../shared/terminal-output-source-range'
import {
  TERMINAL_SOURCE_RANGE_STREAM_MAX_BYTES,
  TerminalSourceRangeLedger
} from './terminal-source-range-ledger'
import { TerminalSourceRangeRegistry } from './terminal-source-range-registry'

function range(overrides: Partial<TerminalOutputSourceRange> = {}): TerminalOutputSourceRange {
  return {
    id: 'pty-1',
    spanId: 'span-1',
    providerGeneration: 4,
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

describe('TerminalSourceRangeLedger', () => {
  it('rejects partial encoded boundaries without changing its watermark', () => {
    const ledger = new TerminalSourceRangeLedger('generation-1')
    ledger.accept(5, 4, [range()])
    ledger.accept(7, 5, [
      range({
        spanId: 'span-2',
        sourceStartSu: 4,
        sourceEndSu: 9,
        displayStart: 4,
        displayEnd: 9,
        transform: { transformed: false, rawLengthSu: 5, scalarSafe: true }
      })
    ])

    expect(ledger.acknowledge('generation-1', 3).status).toBe('invalid')
    expect(ledger.getDebugSnapshot()).toMatchObject({
      ackedEndByte: 0,
      retainedBytes: 12,
      frames: 2
    })
    expect(ledger.acknowledge('generation-1', 12)).toMatchObject({
      status: 'accepted',
      acknowledgedBytes: 12,
      settled: [{ spanId: 'span-1' }, { spanId: 'span-2' }]
    })
  })

  it('rejects malformed coverage, gaps, and later cross-token mappings', () => {
    const ledger = new TerminalSourceRangeLedger('generation-1')
    expect(ledger.accept(5, 3, [range()])).toBeNull()
    expect(ledger.accept(5, 4, [range()])).not.toBeNull()
    expect(
      ledger.accept(5, 4, [
        range({
          spanId: 'gap',
          sourceStartSu: 5,
          sourceEndSu: 9,
          displayStart: 4,
          displayEnd: 8
        })
      ])
    ).toBeNull()
    expect(
      ledger.prepareAccept(5, 4, [
        range({
          spanId: 'other',
          deliveryToken: 'token-2',
          sourceStartSu: 4,
          sourceEndSu: 8,
          displayStart: 4,
          displayEnd: 8
        })
      ]).status
    ).toBe('cross-generation')
    expect(ledger.getDebugSnapshot()).toMatchObject({ retainedBytes: 5, frames: 1 })
  })

  it('rejects mixing mapped and unmapped output in either order', () => {
    const mapped = new TerminalSourceRangeLedger('mapped')
    expect(mapped.accept(5, 4, [range()])).not.toBeNull()
    expect(mapped.prepareAccept(1, 1, []).status).toBe('invalid')

    const unmapped = new TerminalSourceRangeLedger('unmapped')
    expect(unmapped.accept(1, 1, [])).not.toBeNull()
    expect(unmapped.prepareAccept(5, 4, [range()]).status).toBe('invalid')
  })

  it('rejects excessive, stale, notification-shaped, and late settlement', () => {
    const ledger = new TerminalSourceRangeLedger('generation-1')
    ledger.accept(5, 4, [range()])

    expect(ledger.acknowledge('generation-2', 5).status).toBe('stale-generation')
    expect(ledger.acknowledge('generation-1', 6).status).toBe('excessive')
    expect(ledger.acknowledge('generation-1', Number.NaN).status).toBe('invalid')
    const transfer = ledger.beginTransfer()
    transfer.commit()
    expect(ledger.acknowledge('generation-1', 5).status).toBe('invalid')
    expect(ledger.getDebugSnapshot()).toMatchObject({ ackedEndByte: 0, closed: true })
  })

  it('restores all mappings when an atomic transfer rolls back', () => {
    const ledger = new TerminalSourceRangeLedger('generation-1')
    ledger.accept(5, 4, [range()])
    const transfer = ledger.beginTransfer()

    expect(transfer.frames).toHaveLength(1)
    expect(ledger.canAccept(1)).toBe(false)
    transfer.rollback()
    expect(ledger.getDebugSnapshot()).toMatchObject({
      retainedBytes: 5,
      frames: 1,
      transferring: false,
      closed: false
    })

    const retry = ledger.beginTransfer()
    retry.commit()
    expect(ledger.getDebugSnapshot()).toMatchObject({
      retainedBytes: 0,
      frames: 0,
      closed: true
    })
  })

  it('replaces covered mappings without synthesizing encoded-byte credit', () => {
    const ledger = new TerminalSourceRangeLedger('generation-1')
    ledger.accept(5, 4, [range()], 4)
    ledger.accept(
      7,
      4,
      [
        range({
          spanId: 'span-trailing',
          sourceStartSu: 4,
          sourceEndSu: 8,
          displayStart: 4,
          displayEnd: 8
        })
      ],
      8
    )
    const replacement = ledger.planSourceRangeReplacement(8)

    expect(replacement).not.toBeNull()
    expect(() => replacement?.commit()).not.toThrow()
    expect(ledger.acknowledge('generation-1', 12)).toMatchObject({
      status: 'accepted',
      acknowledgedBytes: 12,
      settled: []
    })
    expect(
      ledger.accept(
        3,
        2,
        [
          range({
            spanId: 'span-live',
            sourceStartSu: 8,
            sourceEndSu: 10,
            displayStart: 8,
            displayEnd: 10,
            transform: { transformed: false, rawLengthSu: 2, scalarSafe: true }
          })
        ],
        10
      )
    ).not.toBeNull()
  })

  it('rejects an admitted trailing mapping before authoritative commit', () => {
    const ledger = new TerminalSourceRangeLedger('generation-1')
    ledger.accept(5, 4, [range()], 4)
    ledger.accept(
      7,
      4,
      [
        range({
          spanId: 'span-trailing',
          sourceStartSu: 4,
          sourceEndSu: 8,
          displayStart: 4,
          displayEnd: 8
        })
      ],
      8
    )

    expect(ledger.planSourceRangeReplacement(4)).toBeNull()
  })

  it('rejects an unsequenced mapped frame before replacement commit', () => {
    const ledger = new TerminalSourceRangeLedger('generation-1')
    ledger.accept(5, 4, [range()])

    expect(ledger.planSourceRangeReplacement(4)).toBeNull()
  })

  it('rolls back a pre-send admission without accepting a byte boundary', () => {
    const registry = new TerminalSourceRangeRegistry()
    const ledger = registry.open('generation-1')!
    const prepared = ledger.prepareAccept(5, 4, [range()])
    expect(prepared.status).toBe('ready')
    if (prepared.status !== 'ready') {
      throw new Error('expected source range admission')
    }
    expect(registry.getDebugSnapshot().retainedBytes).toBe(5)

    prepared.admission.rollback()

    expect(ledger.getDebugSnapshot()).toMatchObject({
      acceptedEndByte: 0,
      retainedBytes: 0,
      frames: 0
    })
    expect(registry.getDebugSnapshot().retainedBytes).toBe(0)
  })

  it('bounds aggregate retained mapping bytes and releases them on ACK and close', () => {
    const registry = new TerminalSourceRangeRegistry()
    const ledgers = Array.from({ length: 9 }, (_, index) => registry.open(`stream-${index}`)!)
    for (const ledger of ledgers.slice(0, 8)) {
      expect(ledger.accept(TERMINAL_SOURCE_RANGE_STREAM_MAX_BYTES, 0, [])).not.toBeNull()
    }
    expect(ledgers[8]!.canAccept(1)).toBe(false)
    expect(registry.getDebugSnapshot().retainedBytes).toBe(16 * 1024 * 1024)

    expect(ledgers[0]!.acknowledge('stream-0', TERMINAL_SOURCE_RANGE_STREAM_MAX_BYTES).status).toBe(
      'accepted'
    )
    expect(ledgers[8]!.accept(1, 0, [])).not.toBeNull()
    for (const ledger of ledgers) {
      ledger.close()
    }
    expect(registry.getDebugSnapshot()).toEqual({ streams: 0, retainedBytes: 0 })
  })
})
