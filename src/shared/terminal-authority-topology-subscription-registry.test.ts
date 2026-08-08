import { describe, expect, it } from 'vitest'
import { parseTerminalAuthorityTopologySnapshotRequest } from './terminal-authority-topology-stream-validation'
import { TerminalAuthorityTopologySubscriptionRegistry } from './terminal-authority-topology-subscription-registry'

function request(subscriptionId: string, namespaceId = 'namespace-a') {
  return parseTerminalAuthorityTopologySnapshotRequest({
    protocolVersion: 1,
    subscriptionId,
    namespace: { authorityHostId: 'host-a', namespaceId }
  })
}

describe('terminal authority topology subscription registry', () => {
  it('replaces a resnapshot subscription without growing the connection registry', () => {
    const registry = new TerminalAuthorityTopologySubscriptionRegistry<string>()
    const exact = request('subscription-a')

    expect(registry.upsert(exact, 'first')).toBeNull()
    expect(registry.upsert(exact, 'replacement')).toBe('first')
    expect(registry.size).toBe(1)
    expect(registry.remove(exact)).toBe('replacement')
    expect(registry.size).toBe(0)
  })

  it('rejects cross-namespace subscription ID reuse', () => {
    const registry = new TerminalAuthorityTopologySubscriptionRegistry<string>()
    registry.upsert(request('subscription-a'), 'first')

    expect(() => registry.upsert(request('subscription-a', 'namespace-b'), 'second')).toThrow(
      'identity_conflict'
    )
    expect(() => registry.remove(request('subscription-a', 'namespace-b'))).toThrow(
      'identity_conflict'
    )
    expect(registry.size).toBe(1)
  })

  it('bounds each connection and returns every retained subscription on close', () => {
    const registry = new TerminalAuthorityTopologySubscriptionRegistry<string>(2)
    registry.upsert(request('subscription-a'), 'first')
    registry.upsert(request('subscription-b'), 'second')

    expect(() => registry.upsert(request('subscription-c'), 'third')).toThrow('capacity')
    expect(registry.clear()).toEqual(['first', 'second'])
    expect(registry.size).toBe(0)
  })
})
