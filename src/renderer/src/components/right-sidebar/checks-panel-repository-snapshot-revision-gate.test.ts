import { describe, expect, it } from 'vitest'
import type { GitRepositorySnapshotSubscriptionEvent } from '../../../../shared/git-repository-snapshot'
import { ChecksPanelRepositorySnapshotRevisionGate } from './checks-panel-repository-snapshot-revision-gate'

function event(
  revision: number,
  state: 'invalidated' | 'ready' = 'ready',
  generation = 0,
  incarnation = 0
): GitRepositorySnapshotSubscriptionEvent {
  return { state, generation, revision, incarnation }
}

describe('ChecksPanelRepositorySnapshotRevisionGate', () => {
  it('requests one refresh for a newer ready revision while idle', () => {
    const gate = new ChecksPanelRepositorySnapshotRevisionGate()

    expect(gate.observe(event(1))).toBe(true)
    expect(gate.observe(event(1))).toBe(false)
    expect(gate.observe(event(2))).toBe(false)
  })

  it('consumes a self-published ready revision observed by the active read', () => {
    const gate = new ChecksPanelRepositorySnapshotRevisionGate()

    const read = gate.begin()
    expect(gate.observe(event(4))).toBe(false)
    expect(gate.finish(read, 4)).toBe(false)
  })

  it('requests a trailing refresh for a newer publication than the active read observed', () => {
    const gate = new ChecksPanelRepositorySnapshotRevisionGate()

    const read = gate.begin()
    expect(gate.observe(event(5))).toBe(false)
    expect(gate.observe(event(6))).toBe(false)
    expect(gate.finish(read, 5)).toBe(true)
  })

  it('does not consume a replacement-provider publication with an old read revision', () => {
    const gate = new ChecksPanelRepositorySnapshotRevisionGate()

    const read = gate.begin()
    expect(gate.isCurrent(read)).toBe(true)
    expect(gate.observe(event(0, 'invalidated', 0, 2))).toBe(false)
    expect(gate.isCurrent(read)).toBe(false)
    expect(gate.observe(event(2, 'ready', 0, 2))).toBe(false)
    expect(gate.finish(read, 20)).toBe(true)
  })

  it('advances invalidation fences without launching a premature refresh', () => {
    const gate = new ChecksPanelRepositorySnapshotRevisionGate()

    expect(gate.observe(event(3, 'invalidated', 1))).toBe(false)
    expect(gate.observe(event(2, 'ready', 0))).toBe(false)
    expect(gate.observe(event(4, 'ready', 1))).toBe(true)
  })

  it('resets context-local scheduling state', () => {
    const gate = new ChecksPanelRepositorySnapshotRevisionGate()

    expect(gate.observe(event(1))).toBe(true)
    gate.reset()
    expect(gate.observe(event(1))).toBe(true)
  })

  it('ignores a read that settles after a context reset', () => {
    const gate = new ChecksPanelRepositorySnapshotRevisionGate()
    const staleRead = gate.begin()
    gate.reset()
    const currentRead = gate.begin()
    expect(gate.observe(event(2))).toBe(false)

    expect(gate.finish(staleRead, 20)).toBe(false)
    expect(gate.finish(currentRead, 1)).toBe(true)
  })
})
