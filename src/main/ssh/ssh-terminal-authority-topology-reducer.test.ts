import { describe, expect, it } from 'vitest'
import {
  parseTerminalAuthorityTopologyChange,
  parseTerminalAuthorityTopologySnapshot
} from '../../shared/terminal-authority-topology-stream-validation'
import { SshTerminalAuthorityTopologyReducer } from './ssh-terminal-authority-topology-reducer'

const namespace = { authorityHostId: 'host-a', namespaceId: 'namespace-a' }
const binding = {
  ownerIncarnationId: 'owner-a',
  physicalPtyId: 'pty-a',
  ptyIncarnationId: 'incarnation-a'
}

function pane(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    paneKey: 'pane-a',
    paneGenerationId: 'generation-a',
    status: 'open',
    binding,
    lastBinding: binding,
    revision: 2,
    ownerStatus: 'reachable',
    ...overrides
  }
}

function notices(revision = 1): Record<string, unknown> {
  return { version: 1, revision, notices: [] }
}

function snapshot(overrides: Record<string, unknown> = {}) {
  return parseTerminalAuthorityTopologySnapshot({
    protocolVersion: 1,
    subscriptionId: 'subscription-a',
    streamIncarnationId: 'stream-a',
    namespace,
    writerEpoch: 3,
    authorityRevision: 2,
    appliedChangeSequence: 7,
    panes: [pane()],
    namespaceRecoveryNotices: notices(),
    ...overrides
  })
}

function change(overrides: Record<string, unknown> = {}) {
  return parseTerminalAuthorityTopologyChange({
    protocolVersion: 1,
    subscriptionId: 'subscription-a',
    streamIncarnationId: 'stream-a',
    namespace,
    writerEpoch: 3,
    baseAuthorityRevision: 2,
    authorityRevision: 3,
    changeSequence: 8,
    paneChanges: [{ kind: 'upsert', pane: pane({ revision: 3 }) }],
    ...overrides
  })
}

describe('SSH terminal authority topology reducer', () => {
  it('applies one contiguous exact namespace change', () => {
    const reducer = new SshTerminalAuthorityTopologyReducer()
    reducer.replace(snapshot())

    const result = reducer.apply(change())

    expect(result.kind).toBe('applied')
    expect(reducer.state()).toMatchObject({
      streamIncarnationId: 'stream-a',
      authorityRevision: 3,
      appliedChangeSequence: 8
    })
  })

  it('atomically retires a binding while preserving its last binding', () => {
    const reducer = new SshTerminalAuthorityTopologyReducer()
    reducer.replace(snapshot())
    const result = reducer.apply(
      change({
        paneChanges: [
          {
            kind: 'upsert',
            pane: pane({ status: 'closed', binding: null, ownerStatus: null, revision: 3 })
          }
        ]
      })
    )

    expect(result.kind).toBe('applied')
    expect(reducer.state()?.panes[0]).toMatchObject({
      status: 'closed',
      binding: null,
      lastBinding: binding
    })
  })

  it('retains an open unbound pane without inferring an allocation', () => {
    const reducer = new SshTerminalAuthorityTopologyReducer()
    reducer.replace(
      snapshot({
        panes: [pane({ binding: null, lastBinding: null, ownerStatus: null })]
      })
    )

    expect(reducer.state()?.panes[0]).toMatchObject({
      status: 'open',
      binding: null,
      ownerStatus: null
    })
    expect(reducer.state()).not.toHaveProperty('allocations')
  })

  it('keeps the last exact state non-mutated across a sequence gap', () => {
    const reducer = new SshTerminalAuthorityTopologyReducer()
    const initial = reducer.replace(snapshot())

    expect(reducer.apply(change({ changeSequence: 9 }))).toEqual({
      kind: 'resnapshot-required',
      reason: 'sequence-gap'
    })
    expect(reducer.state()).toBe(initial)
  })

  it('rejects a regressed snapshot from the same authority lineage', () => {
    const reducer = new SshTerminalAuthorityTopologyReducer()
    reducer.replace(
      snapshot({
        authorityRevision: 5,
        appliedChangeSequence: 9,
        panes: [],
        namespaceRecoveryNotices: notices(5)
      })
    )

    expect(
      reducer.snapshotConflict(
        snapshot({
          authorityRevision: 4,
          appliedChangeSequence: 8,
          panes: [],
          namespaceRecoveryNotices: notices(4)
        })
      )
    ).toBe('snapshot-regressed')
    expect(reducer.state()).toMatchObject({ authorityRevision: 5, appliedChangeSequence: 9 })
  })

  it.each([
    ['stream-incarnation-changed', { streamIncarnationId: 'stream-b' }],
    ['writer-epoch-changed', { writerEpoch: 4 }],
    ['subscription-changed', { subscriptionId: 'subscription-b' }],
    ['namespace-changed', { namespace: { ...namespace, namespaceId: 'namespace-b' } }]
  ] as const)('requires a resnapshot when %s', (reason, override) => {
    const reducer = new SshTerminalAuthorityTopologyReducer()
    reducer.replace(snapshot())

    expect(reducer.apply(change(override))).toEqual({ kind: 'resnapshot-required', reason })
  })

  it('distinguishes exact duplicate delivery from a conflicting duplicate', () => {
    const reducer = new SshTerminalAuthorityTopologyReducer()
    reducer.replace(snapshot())
    const applied = change()
    expect(reducer.apply(applied).kind).toBe('applied')

    expect(reducer.apply(applied)).toEqual({ kind: 'duplicate', reason: 'exact-replay' })
    expect(
      reducer.apply(
        change({
          paneChanges: [
            {
              kind: 'upsert',
              pane: pane({ revision: 3, ownerStatus: 'owner-unreachable' })
            }
          ]
        })
      )
    ).toEqual({ kind: 'resnapshot-required', reason: 'sequence-conflict' })
  })

  it('treats notifications at the snapshot high-watermark as already covered', () => {
    const reducer = new SshTerminalAuthorityTopologyReducer()
    reducer.replace(snapshot())

    expect(
      reducer.apply(
        change({
          baseAuthorityRevision: 1,
          authorityRevision: 2,
          changeSequence: 7,
          paneChanges: [
            { kind: 'upsert', pane: pane({ revision: 2, ownerStatus: 'owner-unreachable' }) }
          ]
        })
      )
    ).toEqual({ kind: 'duplicate', reason: 'covered-by-snapshot' })
  })

  it('rejects authority revision and namespace recovery revision regressions', () => {
    const reducer = new SshTerminalAuthorityTopologyReducer()
    reducer.replace(snapshot({ namespaceRecoveryNotices: notices(5) }))

    expect(reducer.apply(change({ baseAuthorityRevision: 1 }))).toEqual({
      kind: 'resnapshot-required',
      reason: 'revision-conflict'
    })
    expect(
      reducer.apply(
        change({
          paneChanges: [],
          authorityRevision: 2,
          namespaceRecoveryNotices: notices(4)
        })
      )
    ).toEqual({ kind: 'resnapshot-required', reason: 'recovery-revision-conflict' })
  })

  it('rejects a delta that would leave contradictory topology', () => {
    const reducer = new SshTerminalAuthorityTopologyReducer()
    reducer.replace(snapshot())

    expect(
      reducer.apply(
        change({
          paneChanges: [
            {
              kind: 'upsert',
              pane: pane({
                paneKey: 'pane-b',
                paneGenerationId: 'generation-b',
                revision: 3
              })
            }
          ]
        })
      )
    ).toEqual({ kind: 'resnapshot-required', reason: 'topology-conflict' })
    expect(reducer.state()?.panes).toHaveLength(1)
    expect(reducer.state()?.panes[0]).toMatchObject({ paneKey: 'pane-a', revision: 2 })
  })

  it('rejects a per-pane revision regression even when the authority revision advances', () => {
    const reducer = new SshTerminalAuthorityTopologyReducer()
    reducer.replace(snapshot())

    expect(
      reducer.apply(change({ paneChanges: [{ kind: 'upsert', pane: pane({ revision: 1 }) }] }))
    ).toEqual({ kind: 'resnapshot-required', reason: 'topology-conflict' })
    expect(reducer.state()?.panes[0]).toMatchObject({ revision: 2 })
  })

  it('allows only derived owner status to change at the same pane revision', () => {
    const reducer = new SshTerminalAuthorityTopologyReducer()
    reducer.replace(snapshot())

    expect(
      reducer.apply(
        change({
          authorityRevision: 2,
          paneChanges: [
            { kind: 'upsert', pane: pane({ revision: 2, ownerStatus: 'owner-unreachable' }) }
          ]
        })
      ).kind
    ).toBe('applied')

    const conflicting = new SshTerminalAuthorityTopologyReducer()
    conflicting.replace(snapshot())
    expect(
      conflicting.apply(
        change({
          authorityRevision: 2,
          paneChanges: [
            {
              kind: 'upsert',
              pane: pane({ status: 'closed', binding: null, ownerStatus: null, revision: 2 })
            }
          ]
        })
      )
    ).toEqual({ kind: 'resnapshot-required', reason: 'topology-conflict' })
  })

  it('fails closed on a conflicting snapshot at the same lineage high-watermark', () => {
    const reducer = new SshTerminalAuthorityTopologyReducer()
    reducer.replace(snapshot())

    expect(
      reducer.snapshotConflict(snapshot({ panes: [pane({ ownerStatus: 'owner-unreachable' })] }))
    ).toBe('snapshot-conflict')
  })
})
