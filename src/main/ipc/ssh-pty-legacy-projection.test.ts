import { describe, expect, it } from 'vitest'
import { SshPtyLegacyProjectionLedger } from './ssh-pty-legacy-projection'

function reserve(
  ledger: SshPtyLegacyProjectionLedger,
  overrides: Partial<Parameters<SshPtyLegacyProjectionLedger['reserve']>[0]> = {}
) {
  return ledger.reserve({
    ptyId: 'pty-1',
    providerGeneration: 3,
    ptyIncarnation: 'incarnation-1',
    data: 'abc',
    sequenceEnd: 3,
    rawLength: 3,
    transformed: false,
    ...overrides
  })
}

describe('SshPtyLegacyProjectionLedger', () => {
  it('rolls back scanner and display reservations before commit', () => {
    const ledger = new SshPtyLegacyProjectionLedger()
    const partial = reserve(ledger, { data: '\x1b[?20', rawLength: 5, sequenceEnd: 5 })
    expect(ledger.rollback(partial)).toBe(true)

    const next = reserve(ledger, { data: '31h', sequenceEnd: 3 })
    expect(next.semantics.identity.displayStart).toBe(0)
    expect(next.semantics.beforeScanner).toEqual({ tail: '', pendingSubscribe: false })
    expect(next.semantics.decision).toBeNull()
  })

  it('keeps immutable generation, incarnation, display, sequence, raw length, and scanner facts', () => {
    const ledger = new SshPtyLegacyProjectionLedger()
    const first = reserve(ledger, {
      data: '\x1b[?2031h',
      rawLength: 11,
      sequenceEnd: 11
    })
    const semantics = ledger.commit(first)

    expect(semantics.identity).toMatchObject({
      providerGeneration: 3,
      ptyIncarnation: 'incarnation-1',
      displayStart: 0,
      displayEnd: 8,
      sequenceEnd: 11,
      rawLength: 11
    })
    expect(semantics.decision).toBe('subscribed')
    expect(Object.isFrozen(semantics)).toBe(true)
    expect(Object.isFrozen(semantics.identity)).toBe(true)
  })

  it('rejects stale generations and resets cross-chunk scanner state on gaps', () => {
    const ledger = new SshPtyLegacyProjectionLedger()
    ledger.commit(reserve(ledger, { data: '\x1b[?20', rawLength: 5, sequenceEnd: 5 }))
    ledger.resetForGap('pty-1')
    const next = reserve(ledger, { data: '31h', sequenceEnd: 8 })
    expect(next.semantics.beforeScanner).toEqual({ tail: '', pendingSubscribe: false })

    expect(() => reserve(ledger, { providerGeneration: 2 })).toThrow(
      'ssh_projection_stale_generation'
    )
  })

  it('publishes, settles, and transfers explicit ranges', () => {
    const ledger = new SshPtyLegacyProjectionLedger()
    const first = ledger.commit(reserve(ledger))
    ledger.publishPrefix([first.identity.projectionSemanticsId], 3, 3)
    expect(ledger.settlePublishedPrefix('pty-1', 2)).toBe(2)
    expect(ledger.transfer([first.identity.projectionSemanticsId], 'renderer-reload')).toBe(1)
    expect(ledger.getDebugSnapshot()).toMatchObject({ transferred: 1, records: 0 })
  })

  it('publishes and settles transformed source accounting with no display text', () => {
    const ledger = new SshPtyLegacyProjectionLedger()
    const projection = ledger.commit(
      reserve(ledger, {
        data: '',
        sequenceEnd: 9,
        rawLength: 9,
        transformed: true
      })
    )

    ledger.publishPrefix([projection.identity.projectionSemanticsId], 0, 9)
    expect(ledger.settlePublishedPrefix('pty-1', 9)).toBe(9)
    expect(ledger.getDebugSnapshot()).toMatchObject({ settled: 1, records: 0 })
  })

  it('reclaims a closed PTY cursor so its id can be reused by a new incarnation', () => {
    const ledger = new SshPtyLegacyProjectionLedger()
    ledger.commit(reserve(ledger))
    ledger.closePty('pty-1', 3, 'incarnation-1', 'pty-exit')

    const next = reserve(ledger, {
      ptyIncarnation: 'incarnation-2',
      data: 'next',
      sequenceEnd: 4,
      rawLength: 4
    })
    expect(next.semantics.identity).toMatchObject({
      ptyIncarnation: 'incarnation-2',
      displayStart: 0
    })
    expect(ledger.getDebugSnapshot()).toMatchObject({ records: 1, cursors: 1 })
  })
})
