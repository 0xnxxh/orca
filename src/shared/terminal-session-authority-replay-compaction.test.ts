import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import type {
  TerminalAuthorityOutcome,
  TerminalSessionAuthorityChange,
  TerminalSessionAuthorityMutationRequest
} from './terminal-session-authority-mutation'
import { terminalAuthorityOperationIdentity } from './terminal-session-authority-operation-identity'
import { TerminalSessionAuthorityState } from './terminal-session-authority-state'

const namespace = Object.freeze({ authorityHostId: 'host-a', namespaceId: 'namespace-a' })
const pane = Object.freeze({ paneKey: 'pane-a', paneGenerationId: 'generation-a' })

describe('terminal authority global journal compaction', () => {
  it('retains one mutation result until every consumer ACKs it', () => {
    const state = createState(2)
    claim(state, 'consumer-a', 'incarnation-a')
    claim(state, 'consumer-b', 'incarnation-b')
    const created = mutate(state, 'create', { kind: 'create', pane })

    acknowledge(state, 'consumer-a', 'incarnation-a', created.outcome.sequence)
    expect(state.planMutation(created.request)).toMatchObject({
      duplicate: true,
      outcome: { sequence: 1 }
    })
    expect(state.readOutcomes('consumer-b', 'incarnation-b', 0)).toMatchObject({
      kind: 'entries',
      entries: [{ sequence: 1 }]
    })

    acknowledge(state, 'consumer-b', 'incarnation-b', created.outcome.sequence)
    expect(() => state.planMutation(created.request)).toThrowError(
      expect.objectContaining({ code: 'operation-conflict' })
    )
    expect(state.snapshot()).toMatchObject({
      outcomeFloorSequence: 1,
      nextOutcomeSequence: 2,
      outcomes: [],
      consumers: [
        { consumerId: 'consumer-a', acknowledgedSequence: 1 },
        { consumerId: 'consumer-b', acknowledgedSequence: 1 }
      ]
    })
  })

  it('restores one shared unsettled result with independent cursors', () => {
    const first = createState(2)
    claim(first, 'consumer-a', 'incarnation-a')
    claim(first, 'consumer-b', 'incarnation-b')
    const created = mutate(first, 'create', { kind: 'create', pane })
    acknowledge(first, 'consumer-a', 'incarnation-a', created.outcome.sequence)

    const restored = TerminalSessionAuthorityState.restore(
      first.snapshot(),
      2,
      'owner-a',
      limits(2)
    )
    expect(restored.planMutation(created.request)).toMatchObject({ duplicate: true })
    expect(restored.snapshotForConsumer('consumer-a', 'incarnation-a')).toMatchObject({
      acknowledgedSequence: 1,
      outcomeHighWatermark: 1
    })
    expect(restored.readOutcomes('consumer-b', 'incarnation-b', 0)).toMatchObject({
      kind: 'entries',
      entries: [{ sequence: 1 }]
    })
  })

  it('starts a genuinely new consumer at the tail without resetting existing cursors', () => {
    const state = createState(3)
    claim(state, 'consumer-a', 'incarnation-a')
    mutate(state, 'create', { kind: 'create', pane })
    claim(state, 'consumer-b', 'incarnation-b')

    expect(state.snapshotForConsumer('consumer-a', 'incarnation-a')).toMatchObject({
      acknowledgedSequence: 0,
      outcomeHighWatermark: 1
    })
    expect(state.snapshotForConsumer('consumer-b', 'incarnation-b')).toMatchObject({
      acknowledgedSequence: 1,
      outcomeHighWatermark: 1
    })

    const rotation = state.planConsumerClaim('consumer-a', 'incarnation-a', 'incarnation-a-next')
    state.applyEvent(rotation!)
    expect(state.snapshotForConsumer('consumer-a', 'incarnation-a-next')).toMatchObject({
      acknowledgedSequence: 0
    })
  })

  it('releases an explicitly retired consumer cursor without accepting a stale incarnation', () => {
    const state = createState(2)
    claim(state, 'host-effects', 'host-incarnation')
    claim(state, 'device-a', 'device-incarnation')
    const created = mutate(state, 'create-retirement', { kind: 'create', pane })
    acknowledge(state, 'host-effects', 'host-incarnation', created.outcome.sequence)

    expect(() => state.planConsumerRetirement('device-a', 'stale-incarnation')).toThrowError(
      expect.objectContaining({ code: 'consumer-conflict' })
    )

    const retirement = state.planConsumerRetirement('device-a', 'device-incarnation')
    expect(retirement).not.toBeNull()
    state.applyEvent(retirement!)

    expect(state.snapshot().outcomeFloorSequence).toBe(created.outcome.sequence)
    expect(state.planConsumerRetirement('device-a', 'device-incarnation')).toBeNull()
  })

  it('rejects snapshot journal gaps and cursor floors that could skip delivery', () => {
    const state = createState(2)
    claim(state, 'consumer-a', 'incarnation-a')
    claim(state, 'consumer-b', 'incarnation-b')
    mutate(state, 'create', { kind: 'create', pane })
    const snapshot = state.snapshot()

    expect(() =>
      TerminalSessionAuthorityState.restore({ ...snapshot, outcomes: [] }, 2, 'owner-a', limits(2))
    ).toThrowError(expect.objectContaining({ code: 'record-corrupt' }))
    expect(() =>
      TerminalSessionAuthorityState.restore(
        { ...snapshot, outcomeFloorSequence: 1 },
        2,
        'owner-a',
        limits(2)
      )
    ).toThrowError(expect.objectContaining({ code: 'record-corrupt' }))
  })

  it('rejects operation and outcome identity reuse after the durable floor', () => {
    const state = createState(1)
    claim(state, 'consumer-a', 'incarnation-a')
    const created = mutate(state, 'create', { kind: 'create', pane })
    acknowledge(state, 'consumer-a', 'incarnation-a', created.outcome.sequence)
    const current = request(state, 'close', {
      kind: 'close',
      pane,
      expected: { paneGenerationId: pane.paneGenerationId, binding: null }
    })

    expect(() =>
      state.planMutation({
        ...current,
        operationId: created.request.operationId,
        outcomeId: created.request.outcomeId
      })
    ).toThrowError(expect.objectContaining({ code: 'operation-conflict' }))
    expect(() =>
      state.planMutation({ ...current, outcomeId: created.request.outcomeId })
    ).toThrowError(expect.objectContaining({ code: 'operation-conflict' }))
  })

  it('keeps checkpoint and reopen cost independent of fully ACKed history', () => {
    const state = createState(1)
    claim(state, 'consumer-a', 'incarnation-a')
    acknowledge(
      state,
      'consumer-a',
      'incarnation-a',
      mutate(state, 'create', { kind: 'create', pane }).outcome.sequence
    )

    for (let index = 0; index < 2_000; index++) {
      const allocation = Object.freeze({
        allocationId: `allocation-${index}`,
        pane,
        ownerIncarnationId: 'owner-a',
        physicalPtyId: `pty-${index}`,
        spawnFingerprint: `spawn-${index}`
      })
      acknowledge(
        state,
        'consumer-a',
        'incarnation-a',
        mutate(state, `prepare-${index}`, {
          kind: 'prepare-allocation',
          allocation,
          expected: { paneGenerationId: pane.paneGenerationId, binding: null }
        }).outcome.sequence
      )
      acknowledge(
        state,
        'consumer-a',
        'incarnation-a',
        mutate(state, `cancel-${index}`, {
          kind: 'cancel-allocation',
          allocation,
          expected: { paneGenerationId: pane.paneGenerationId, binding: null }
        }).outcome.sequence
      )
    }

    const snapshot = state.snapshot()
    const snapshotBytes = Buffer.byteLength(JSON.stringify(snapshot), 'utf8')
    const reopenStartedAt = performance.now()
    const reopened = TerminalSessionAuthorityState.restore(snapshot, 2, 'owner-a', limits(1))
    const reopenMs = performance.now() - reopenStartedAt

    expect(snapshotBytes).toBeLessThan(4_096)
    expect(reopenMs).toBeLessThan(1_000)
    expect(reopened.snapshot()).toMatchObject({
      outcomeFloorSequence: 4_001,
      nextOutcomeSequence: 4_002,
      outcomes: [],
      consumers: [{ acknowledgedSequence: 4_001 }]
    })
  })
})

function createState(maxRetainedOperationEntries: number): TerminalSessionAuthorityState {
  return new TerminalSessionAuthorityState(
    namespace,
    1,
    'owner-a',
    limits(maxRetainedOperationEntries)
  )
}

function limits(maxRetainedOperationEntries: number) {
  return { maxRetainedOperationEntries, maxRetainedOperationBytes: 16 * 1024 }
}

function claim(
  state: TerminalSessionAuthorityState,
  consumerId: string,
  consumerIncarnationId: string
): void {
  const event = state.planConsumerClaim(consumerId, null, consumerIncarnationId)
  expect(event).not.toBeNull()
  state.applyEvent(event!)
}

function mutate(
  state: TerminalSessionAuthorityState,
  correlationId: string,
  change: TerminalSessionAuthorityChange
): Readonly<{
  request: TerminalSessionAuthorityMutationRequest
  outcome: TerminalAuthorityOutcome
}> {
  const mutationRequest = request(state, correlationId, change)
  const planned = state.planMutation(mutationRequest)
  expect(planned.duplicate).toBe(false)
  state.applyEvent(Object.freeze({ kind: 'mutation', outcome: planned.outcome }))
  return Object.freeze({ request: mutationRequest, outcome: planned.outcome })
}

function request(
  state: TerminalSessionAuthorityState,
  correlationId: string,
  change: TerminalSessionAuthorityChange
): TerminalSessionAuthorityMutationRequest {
  return Object.freeze({
    actorId: 'actor-a',
    ...terminalAuthorityOperationIdentity(state.revision, correlationId),
    baseRevision: state.revision,
    change
  })
}

function acknowledge(
  state: TerminalSessionAuthorityState,
  consumerId: string,
  consumerIncarnationId: string,
  sequence: number
): void {
  const event = state.planOutcomeAck(consumerId, consumerIncarnationId, sequence)
  expect(event).not.toBeNull()
  state.applyEvent(event!)
}
