import { describe, expect, it } from 'vitest'
import {
  createAgentHookBindingStore,
  hashAgentLaunchToken,
  type AgentHookBindingEvent
} from './agent-hook-binding-store'
import { AGENT_STATUS_STALE_AFTER_MS, type ParsedAgentStatusPayload } from './agent-status-types'

function payload(
  state: ParsedAgentStatusPayload['state'],
  prompt = 'do the thing'
): ParsedAgentStatusPayload {
  return { state, prompt, agentType: 'claude' }
}

function event(overrides: Partial<AgentHookBindingEvent> = {}): AgentHookBindingEvent {
  return {
    terminalHandle: 'term_a',
    terminalIncarnationId: 'inc_1',
    receivedAt: 1_000,
    payload: payload('working'),
    ...overrides
  }
}

describe('agent hook binding store', () => {
  it('replaces the binding in place as an agent moves working → done', () => {
    const store = createAgentHookBindingStore()

    const first = store.applyEvent(event({ payload: payload('working'), receivedAt: 1_000 }))
    const second = store.applyEvent(event({ payload: payload('done'), receivedAt: 2_000 }))

    expect(first.accepted).toBe(true)
    expect(second.accepted).toBe(true)
    const snapshot = store.snapshot()
    expect(snapshot.bindings).toHaveLength(1)
    expect(snapshot.bindings[0].payload.state).toBe('done')
    expect(snapshot.bindings[0].receivedAt).toBe(2_000)
    expect(snapshot.bindings[0].revision).toBe(2)
    expect(snapshot.revision).toBe(2)
  })

  it('keeps latest-wins per terminal identity and rejects an out-of-order same-launch event', () => {
    const store = createAgentHookBindingStore()
    store.applyEvent(event({ launchToken: 'tok', receivedAt: 2_000, payload: payload('done') }))

    const late = store.applyEvent(
      event({ launchToken: 'tok', receivedAt: 1_500, payload: payload('working') })
    )

    expect(late).toEqual({ accepted: false, reason: 'stale-event' })
    expect(store.getBinding('term_a', 'inc_1')?.payload.state).toBe('done')
    expect(store.snapshot().revision).toBe(1)
  })

  it('rejects a late event for a cleared incarnation instead of resurrecting it', () => {
    const store = createAgentHookBindingStore()
    store.applyEvent(event({ receivedAt: 1_000 }))

    const cleared = store.clearTerminalIncarnation('term_a', 'inc_1')
    const late = store.applyEvent(event({ receivedAt: 5_000, payload: payload('done') }))

    expect(cleared.removed).toBe(true)
    expect(late).toEqual({ accepted: false, reason: 'cleared-terminal-incarnation' })
    expect(store.getBinding('term_a', 'inc_1')).toBeUndefined()
    expect(store.snapshot().bindings).toEqual([])
    // Why: the clear bumped the revision; the rejected resurrection did not.
    expect(store.snapshot().revision).toBe(2)
  })

  it('never lets a late event from an old launch token overwrite a newer agent', () => {
    const store = createAgentHookBindingStore()
    store.applyEvent(
      event({ launchToken: 'launch-1', receivedAt: 1_000, payload: payload('working', 'first') })
    )

    const relaunch = store.applyEvent(
      event({ launchToken: 'launch-2', receivedAt: 2_000, payload: payload('working', 'second') })
    )
    const lateFromOldLaunch = store.applyEvent(
      event({ launchToken: 'launch-1', receivedAt: 1_500, payload: payload('done', 'first') })
    )
    const simultaneousFromOldLaunch = store.applyEvent(
      event({ launchToken: 'launch-1', receivedAt: 2_000, payload: payload('done', 'first') })
    )

    expect(relaunch.accepted).toBe(true)
    expect(lateFromOldLaunch).toEqual({ accepted: false, reason: 'stale-launch-token' })
    expect(simultaneousFromOldLaunch).toEqual({ accepted: false, reason: 'stale-launch-token' })
    const binding = store.getBinding('term_a', 'inc_1')
    expect(binding?.payload.prompt).toBe('second')
    expect(binding?.launchTokenHash).toBe(hashAgentLaunchToken('launch-2'))
    expect(store.snapshot().revision).toBe(2)
  })

  it('lets a strictly newer launch token take over the terminal', () => {
    const store = createAgentHookBindingStore()
    store.applyEvent(event({ launchToken: 'launch-1', receivedAt: 1_000 }))

    const takeover = store.applyEvent(
      event({ launchToken: 'launch-2', receivedAt: 1_001, payload: payload('working', 'newer') })
    )

    expect(takeover.accepted).toBe(true)
    expect(store.getBinding('term_a', 'inc_1')?.payload.prompt).toBe('newer')
  })

  it('stores only a launch token hash, never the token itself', () => {
    const store = createAgentHookBindingStore()
    store.applyEvent(event({ launchToken: 'super-secret-token' }))

    const binding = store.getBinding('term_a', 'inc_1')
    expect(binding?.launchTokenHash).toBe(hashAgentLaunchToken('super-secret-token'))
    expect(JSON.stringify(binding)).not.toContain('super-secret-token')
  })

  it('accepts a pre-hashed launch token as the same generation identity', () => {
    const store = createAgentHookBindingStore()
    store.applyEvent(event({ launchToken: 'launch-1', receivedAt: 1_000 }))

    const sameGeneration = store.applyEvent(
      event({ launchTokenHash: hashAgentLaunchToken('launch-1'), receivedAt: 1_000 })
    )

    // Same generation ties are accepted; a mismatched token at the same instant would not be.
    expect(sameGeneration.accepted).toBe(true)
  })

  it('allows a fresh incarnation of the same terminal handle after a clear', () => {
    const store = createAgentHookBindingStore()
    store.applyEvent(event({ terminalIncarnationId: 'inc_1', receivedAt: 1_000 }))
    store.clearTerminalIncarnation('term_a', 'inc_1')

    const reused = store.applyEvent(
      event({
        terminalIncarnationId: 'inc_2',
        receivedAt: 500,
        payload: payload('working', 'new shell')
      })
    )

    expect(reused.accepted).toBe(true)
    expect(store.getBinding('term_a', 'inc_1')).toBeUndefined()
    // Why: a fresh incarnation starts with no prior binding, so even an older timestamp lands.
    expect(store.getBinding('term_a', 'inc_2')?.payload.prompt).toBe('new shell')
    expect(store.snapshot().bindings.map((binding) => binding.terminalIncarnationId)).toEqual([
      'inc_2'
    ])
  })

  it('stores, snapshots, and clears a binding that carries no paneKey', () => {
    const store = createAgentHookBindingStore()

    const applied = store.applyEvent(event({ paneKey: undefined, receivedAt: 1_000 }))
    const snapshot = store.snapshot()
    const cleared = store.clearTerminalIncarnation('term_a', 'inc_1')

    expect(applied.accepted).toBe(true)
    expect(snapshot.bindings[0].paneKey).toBeUndefined()
    expect(snapshot.bindings[0].terminalHandle).toBe('term_a')
    expect(cleared.removed).toBe(true)
    expect(store.snapshot().bindings).toEqual([])
  })

  it('keeps a proven paneKey as metadata and drops an unusable one', () => {
    const store = createAgentHookBindingStore()

    store.applyEvent(event({ paneKey: 'tab-1:leaf-1' }))
    store.applyEvent(event({ terminalIncarnationId: 'inc_2', paneKey: '   ' }))

    expect(store.getBinding('term_a', 'inc_1')?.paneKey).toBe('tab-1:leaf-1')
    expect(store.getBinding('term_a', 'inc_2')?.paneKey).toBeUndefined()
  })

  it('omits a cleared binding from the snapshot and bumps the revision', () => {
    const store = createAgentHookBindingStore()
    store.applyEvent(event({ terminalIncarnationId: 'inc_1' }))
    store.applyEvent(event({ terminalIncarnationId: 'inc_2' }))

    const cleared = store.clearTerminalIncarnation('term_a', 'inc_1')
    const snapshot = store.snapshot()

    expect(cleared.revision).toBe(3)
    expect(cleared.binding?.terminalIncarnationId).toBe('inc_1')
    expect(snapshot.revision).toBe(3)
    expect(snapshot.bindings.map((binding) => binding.terminalIncarnationId)).toEqual(['inc_2'])
  })

  it('bumps the revision on accepts and clears but never on rejections', () => {
    const store = createAgentHookBindingStore()
    const revisions: number[] = []

    revisions.push(store.snapshot().revision)
    store.applyEvent(event({ receivedAt: 1_000 }))
    revisions.push(store.snapshot().revision)
    store.applyEvent(event({ receivedAt: 500 })) // rejected: older
    revisions.push(store.snapshot().revision)
    store.applyEvent(event({ terminalHandle: '', receivedAt: 2_000 })) // rejected: identity
    revisions.push(store.snapshot().revision)
    store.applyEvent(event({ receivedAt: 2_000, payload: payload('done') }))
    revisions.push(store.snapshot().revision)
    store.clearTerminalIncarnation('term_a', 'inc_1')
    revisions.push(store.snapshot().revision)
    store.clearTerminalIncarnation('term_a', 'inc_1') // already cleared: no state change
    revisions.push(store.snapshot().revision)
    store.applyEvent(event({ receivedAt: 3_000 })) // rejected: tombstoned
    revisions.push(store.snapshot().revision)

    expect(revisions).toEqual([0, 1, 1, 1, 2, 3, 3, 3])
  })

  it('rejects payloads that are not objects carrying a known agent status state', () => {
    const store = createAgentHookBindingStore()

    const reasons = [
      store.applyEvent(event({ payload: undefined as never })),
      store.applyEvent(event({ payload: null as never })),
      store.applyEvent(event({ payload: 'working' as never })),
      store.applyEvent(event({ payload: { state: 'exploded', prompt: '' } as never })),
      store.applyEvent(event({ payload: { state: 'working' } as never }))
    ]

    expect(reasons).toEqual(reasons.map(() => ({ accepted: false, reason: 'invalid-payload' })))
    expect(store.snapshot()).toEqual({ revision: 0, bindings: [] })
  })

  it('rejects unusable terminal identities, including separator-bearing ones', () => {
    const store = createAgentHookBindingStore()

    const rejections = [
      store.applyEvent(event({ terminalHandle: '   ' })),
      store.applyEvent(event({ terminalIncarnationId: undefined as never })),
      store.applyEvent(event({ terminalHandle: 'a'.repeat(201) })),
      // Why: without the separator guard these two would collide into one binding key.
      store.applyEvent(event({ terminalHandle: 'term_a\u0000inc_1', terminalIncarnationId: 'x' }))
    ]

    expect(rejections).toEqual(
      rejections.map(() => ({ accepted: false, reason: 'invalid-terminal-identity' }))
    )
    expect(store.applyEvent(event({ receivedAt: Number.NaN })).accepted).toBe(false)
    expect(store.snapshot()).toEqual({ revision: 0, bindings: [] })
  })

  it('evicts the oldest binding when every tracked binding is live', () => {
    const store = createAgentHookBindingStore({ maxBindings: 2 })
    store.applyEvent(event({ terminalIncarnationId: 'oldest', receivedAt: 1_000 }))
    store.applyEvent(event({ terminalIncarnationId: 'newer', receivedAt: 1_000 }))

    const applied = store.applyEvent(event({ terminalIncarnationId: 'current', receivedAt: 1_000 }))

    expect(applied.accepted && applied.evicted.map((b) => b.terminalIncarnationId)).toEqual([
      'oldest'
    ])
    expect(store.snapshot().bindings.map((b) => b.terminalIncarnationId)).toEqual([
      'newer',
      'current'
    ])
  })

  it('prefers a done or stale binding over the merely-oldest one, using the injected clock', () => {
    const store = createAgentHookBindingStore({ maxBindings: 3 })
    const now = 10 * AGENT_STATUS_STALE_AFTER_MS
    store.applyEvent(event({ terminalIncarnationId: 'fresh-oldest', receivedAt: now }))
    store.applyEvent(
      event({ terminalIncarnationId: 'stale', receivedAt: now - AGENT_STATUS_STALE_AFTER_MS - 1 })
    )
    store.applyEvent(
      event({ terminalIncarnationId: 'done', receivedAt: now, payload: payload('done') })
    )

    const applied = store.applyEvent(event({ terminalIncarnationId: 'current', receivedAt: now }), {
      now
    })

    expect(applied.accepted && applied.evicted.map((b) => b.terminalIncarnationId)).toEqual([
      'stale'
    ])
    expect(store.snapshot().bindings.map((b) => b.terminalIncarnationId)).toEqual([
      'fresh-oldest',
      'done',
      'current'
    ])
  })

  it('does not tombstone an evicted binding, so a live terminal can re-bind', () => {
    const store = createAgentHookBindingStore({ maxBindings: 1 })
    store.applyEvent(event({ terminalIncarnationId: 'evicted', receivedAt: 1_000 }))
    store.applyEvent(event({ terminalIncarnationId: 'winner', receivedAt: 1_000 }))

    const rebind = store.applyEvent(event({ terminalIncarnationId: 'evicted', receivedAt: 2_000 }))

    expect(rebind.accepted).toBe(true)
    expect(store.getBinding('term_a', 'evicted')?.receivedAt).toBe(2_000)
  })

  it('drops the oldest tombstone once the cleared-incarnation bound is exceeded', () => {
    const store = createAgentHookBindingStore({ maxClearedIncarnations: 2 })
    for (const incarnation of ['inc_1', 'inc_2', 'inc_3']) {
      store.applyEvent(event({ terminalIncarnationId: incarnation, receivedAt: 1_000 }))
      store.clearTerminalIncarnation('term_a', incarnation)
    }

    const pastHorizon = store.applyEvent(
      event({ terminalIncarnationId: 'inc_1', receivedAt: 2_000 })
    )
    const stillFenced = store.applyEvent(
      event({ terminalIncarnationId: 'inc_2', receivedAt: 2_000 })
    )

    // Why: beyond the documented tombstone horizon a late event is indistinguishable from a
    // fresh one, so it is allowed through; the two most recent clears stay fenced.
    expect(pastHorizon.accepted).toBe(true)
    expect(stillFenced).toEqual({ accepted: false, reason: 'cleared-terminal-incarnation' })
    expect(store.applyEvent(event({ terminalIncarnationId: 'inc_3', receivedAt: 2_000 }))).toEqual({
      accepted: false,
      reason: 'cleared-terminal-incarnation'
    })
  })

  it('rejects a non-positive bound instead of silently running unbounded', () => {
    expect(() => createAgentHookBindingStore({ maxBindings: 0 })).toThrow(RangeError)
    expect(() => createAgentHookBindingStore({ maxClearedIncarnations: -1 })).toThrow(RangeError)
  })

  it('hands out copies so a snapshot consumer cannot mutate stored bindings', () => {
    const store = createAgentHookBindingStore()
    store.applyEvent(event({ receivedAt: 1_000 }))

    const snapshot = store.snapshot()
    snapshot.bindings[0].receivedAt = 9_999
    snapshot.bindings.pop()

    expect(store.getBinding('term_a', 'inc_1')?.receivedAt).toBe(1_000)
    expect(store.snapshot().bindings).toHaveLength(1)
  })

  it('keeps stores independent: revisions are per instance', () => {
    const first = createAgentHookBindingStore()
    const second = createAgentHookBindingStore()

    first.applyEvent(event({ receivedAt: 1_000 }))
    first.applyEvent(event({ receivedAt: 2_000, payload: payload('done') }))

    expect(first.snapshot().revision).toBe(2)
    expect(second.snapshot().revision).toBe(0)
  })
})
