import { describe, expect, it } from 'vitest'
import {
  TERMINAL_AUTHORITY_TOPOLOGY_MAX_CHANGE_BYTES,
  TERMINAL_AUTHORITY_TOPOLOGY_MAX_CHANGE_OPERATIONS,
  TERMINAL_AUTHORITY_TOPOLOGY_MAX_SNAPSHOT_BYTES,
  TERMINAL_AUTHORITY_TOPOLOGY_PTY_CAPABILITY,
  TERMINAL_AUTHORITY_TOPOLOGY_STREAM_CAPABILITY,
  ptyCapabilitiesOfferTerminalAuthorityTopology,
  relayDaemonGrantHasTerminalAuthorityTopology,
  terminalAuthorityTopologyGrantFromPtyCapabilities
} from './terminal-authority-topology-stream-contract'
import {
  TerminalAuthorityTopologyStreamValidationError,
  parseTerminalAuthorityTopologyChangeWithByteLength,
  parseTerminalAuthorityTopologySnapshot,
  parseTerminalAuthorityTopologySnapshotRequest
} from './terminal-authority-topology-stream-validation'

const namespace = Object.freeze({ authorityHostId: 'host-a', namespaceId: 'namespace-a' })
const binding = Object.freeze({
  ownerIncarnationId: 'owner-a',
  physicalPtyId: 'pty-a',
  ptyIncarnationId: 'incarnation-a'
})

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

function recoveryProjection(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    revision: 3,
    notices: [
      {
        recoveryKey: 'recovery-a',
        status: 'unresolved',
        reason: 'worker-unreachable',
        preservationKind: 'worker-unreachable',
        workspaceKind: 'folder',
        evidenceDigest: 'digest-a',
        observedAtMs: 10,
        discoveredAtMs: 11,
        updatedAtMs: 12
      }
    ],
    ...overrides
  }
}

function snapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    protocolVersion: 1,
    subscriptionId: 'subscription-a',
    streamIncarnationId: 'stream-a',
    namespace,
    writerEpoch: 4,
    authorityRevision: 2,
    appliedChangeSequence: 7,
    panes: [pane()],
    namespaceRecoveryNotices: recoveryProjection(),
    ...overrides
  }
}

function change(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    protocolVersion: 1,
    subscriptionId: 'subscription-a',
    streamIncarnationId: 'stream-a',
    namespace,
    writerEpoch: 4,
    baseAuthorityRevision: 2,
    authorityRevision: 3,
    changeSequence: 8,
    paneChanges: [
      {
        kind: 'upsert',
        pane: pane({ revision: 3, ownerStatus: 'owner-unreachable' })
      }
    ],
    ...overrides
  }
}

describe('terminal authority topology capability', () => {
  it('keeps the owner hop and end-to-end PTY grants separate', () => {
    expect(
      relayDaemonGrantHasTerminalAuthorityTopology([TERMINAL_AUTHORITY_TOPOLOGY_STREAM_CAPABILITY])
    ).toBe(true)
    expect(relayDaemonGrantHasTerminalAuthorityTopology(['terminal-session.authority.v1'])).toBe(
      false
    )
    expect(relayDaemonGrantHasTerminalAuthorityTopology(undefined)).toBe(false)
    expect(
      terminalAuthorityTopologyGrantFromPtyCapabilities({
        [TERMINAL_AUTHORITY_TOPOLOGY_PTY_CAPABILITY]: { version: 1 }
      })
    ).toEqual({ version: 1 })
    expect(terminalAuthorityTopologyGrantFromPtyCapabilities({})).toBeNull()
    expect(
      ptyCapabilitiesOfferTerminalAuthorityTopology({
        [TERMINAL_AUTHORITY_TOPOLOGY_PTY_CAPABILITY]: { versions: [1, 2] }
      })
    ).toBe(true)
    expect(ptyCapabilitiesOfferTerminalAuthorityTopology(undefined)).toBe(false)
  })
})

describe('terminal authority topology snapshot validation', () => {
  it('accepts an exact namespace snapshot and strips unknown recovery evidence', () => {
    const raw = snapshot({
      namespaceRecoveryNotices: recoveryProjection({
        notices: [
          {
            ...(recoveryProjection().notices as Record<string, unknown>[])[0],
            credentialFile: '/secret/credential',
            paneKey: 'secret-pane',
            workerId: 'secret-worker'
          }
        ]
      })
    })
    const parsed = parseTerminalAuthorityTopologySnapshot(raw)

    expect(parsed).toMatchObject({
      namespace,
      streamIncarnationId: 'stream-a',
      authorityRevision: 2,
      appliedChangeSequence: 7
    })
    expect(parsed.namespaceRecoveryNotices.notices[0]).toEqual({
      recoveryKey: 'recovery-a',
      status: 'unresolved',
      reason: 'worker-unreachable',
      preservationKind: 'worker-unreachable',
      workspaceKind: 'folder',
      evidenceDigest: 'digest-a',
      observedAtMs: 10,
      discoveredAtMs: 11,
      updatedAtMs: 12
    })
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.panes)).toBe(true)
    expect(Object.isFrozen(parsed.namespaceRecoveryNotices.notices[0])).toBe(true)
  })

  it('retains an open unbound pane without exposing spawn evidence', () => {
    const parsed = parseTerminalAuthorityTopologySnapshot(
      snapshot({
        panes: [pane({ binding: null, lastBinding: null, ownerStatus: null })],
        allocations: [{ spawnFingerprint: 'must-not-cross-the-wire' }]
      })
    )

    expect(parsed.panes[0]).toMatchObject({ status: 'open', binding: null, ownerStatus: null })
    expect(parsed).not.toHaveProperty('allocations')
  })

  it('rejects duplicate bindings and two open generations for one pane', () => {
    expect(() =>
      parseTerminalAuthorityTopologySnapshot(
        snapshot({
          panes: [pane(), pane({ paneKey: 'pane-b', paneGenerationId: 'generation-b' })]
        })
      )
    ).toThrow('binds one PTY incarnation twice')
    expect(() =>
      parseTerminalAuthorityTopologySnapshot(
        snapshot({
          panes: [
            pane({ binding: null, ownerStatus: null }),
            pane({
              paneGenerationId: 'generation-b',
              binding: null,
              lastBinding: null,
              ownerStatus: null
            })
          ]
        })
      )
    ).toThrow('two open pane generations')
  })

  it('rejects owner status and binding combinations that cannot be authoritative', () => {
    expect(() =>
      parseTerminalAuthorityTopologySnapshot(
        snapshot({ panes: [pane({ binding: null, ownerStatus: 'reachable' })] })
      )
    ).toThrow('owner status')
    expect(() =>
      parseTerminalAuthorityTopologySnapshot(
        snapshot({ panes: [pane({ binding, ownerStatus: null })] })
      )
    ).toThrow('owner status')
    expect(() =>
      parseTerminalAuthorityTopologySnapshot(
        snapshot({ panes: [pane({ status: 'closed', ownerStatus: 'reachable' })] })
      )
    ).toThrow('inactive topology pane retains a binding')
  })

  it('rejects the secret-rich catalog row shape instead of forwarding it', () => {
    expect(() =>
      parseTerminalAuthorityTopologySnapshot(
        snapshot({
          namespaceRecoveryNotices: {
            version: 1,
            revision: 1,
            notices: [{ recoveryId: 'raw-id', credentialFile: '/secret' }]
          }
        })
      )
    ).toThrow('recoveryKey')
  })

  it('counts UTF-8 bytes, including ignored keys, before retaining a snapshot', () => {
    const oversized = snapshot({
      ignored: '🙂'.repeat(Math.floor(TERMINAL_AUTHORITY_TOPOLOGY_MAX_SNAPSHOT_BYTES / 4) + 1)
    })
    expect(() => parseTerminalAuthorityTopologySnapshot(oversized)).toThrow(
      TerminalAuthorityTopologyStreamValidationError
    )
    expect(() => parseTerminalAuthorityTopologySnapshot(oversized)).toThrow('byte capacity')
  })

  it('validates bounded exact subscription requests', () => {
    expect(
      parseTerminalAuthorityTopologySnapshotRequest({
        protocolVersion: 1,
        subscriptionId: 'subscription-a',
        namespace
      })
    ).toEqual({ protocolVersion: 1, subscriptionId: 'subscription-a', namespace })
    expect(() =>
      parseTerminalAuthorityTopologySnapshotRequest({
        protocolVersion: 1,
        subscriptionId: '',
        namespace
      })
    ).toThrow()
  })
})

describe('terminal authority topology change validation', () => {
  it('accepts a bounded sequenced delta and returns its exact retained bytes', () => {
    const raw = change()
    const parsed = parseTerminalAuthorityTopologyChangeWithByteLength(raw)

    expect(parsed.value).toMatchObject({
      streamIncarnationId: 'stream-a',
      baseAuthorityRevision: 2,
      authorityRevision: 3,
      changeSequence: 8
    })
    expect(parsed.byteLength).toBe(new TextEncoder().encode(JSON.stringify(raw)).byteLength)
  })

  it('allows a notice-only namespace change without inventing an authority revision', () => {
    const parsed = parseTerminalAuthorityTopologyChangeWithByteLength(
      change({
        authorityRevision: 2,
        paneChanges: [],
        namespaceRecoveryNotices: recoveryProjection({ revision: 4 })
      })
    )
    expect(parsed.value.authorityRevision).toBe(2)
    expect(parsed.value.namespaceRecoveryNotices?.revision).toBe(4)
  })

  it('rejects empty, duplicate, over-capacity, and over-revision changes', () => {
    expect(() =>
      parseTerminalAuthorityTopologyChangeWithByteLength(change({ paneChanges: [] }))
    ).toThrow('empty')
    expect(() =>
      parseTerminalAuthorityTopologyChangeWithByteLength(
        change({ paneChanges: [change().paneChanges![0], change().paneChanges![0]] })
      )
    ).toThrow('duplicated')
    const removals = Array.from(
      { length: TERMINAL_AUTHORITY_TOPOLOGY_MAX_CHANGE_OPERATIONS + 1 },
      (_, index) => ({
        kind: 'remove',
        pane: { paneKey: `pane-${index}`, paneGenerationId: `generation-${index}` }
      })
    )
    expect(() =>
      parseTerminalAuthorityTopologyChangeWithByteLength(change({ paneChanges: removals }))
    ).toThrow('capacity')
    expect(() =>
      parseTerminalAuthorityTopologyChangeWithByteLength(
        change({ paneChanges: [{ kind: 'upsert', pane: pane({ revision: 4 }) }] })
      )
    ).toThrow('exceeds authority revision')
  })

  it('counts multi-byte ignored fields against the change budget', () => {
    expect(() =>
      parseTerminalAuthorityTopologyChangeWithByteLength(
        change({
          ignored: '🙂'.repeat(Math.floor(TERMINAL_AUTHORITY_TOPOLOGY_MAX_CHANGE_BYTES / 4) + 1)
        })
      )
    ).toThrow('byte capacity')
  })
})
