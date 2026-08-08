import { describe, expect, it } from 'vitest'
import type { TerminalAuthorityNamespaceOutcomeBoundary } from './terminal-session-authority-consumer-transport'
import { terminalSessionAuthorityBoundaryId } from './terminal-session-authority-boundary-identity'

type UnsignedBoundary = Omit<TerminalAuthorityNamespaceOutcomeBoundary, 'boundaryId'>

describe('terminalSessionAuthorityBoundaryId', () => {
  it('canonicalizes reordered boundary, namespace, and projection properties', () => {
    const original = unsignedBoundary()
    const reordered = {
      projection: {
        materializedOutcomes: [],
        allocations: [],
        panes: [],
        revision: 1,
        writerEpoch: 1,
        namespace: { namespaceId: 'namespace-1', authorityHostId: 'host-1' }
      },
      consumerStart: 'new-at-tail',
      outcomeHighWatermark: 0,
      acknowledgedSequence: 0,
      namespace: { namespaceId: 'namespace-1', authorityHostId: 'host-1' },
      consumer: {
        consumerIncarnationId: 'app-process:one',
        consumerId: 'app-profile:one'
      },
      version: 1
    } satisfies UnsignedBoundary

    expect(terminalSessionAuthorityBoundaryId(reordered)).toBe(
      terminalSessionAuthorityBoundaryId(original)
    )
  })

  it('binds cursor and projection content to the identity', () => {
    const original = unsignedBoundary()

    expect(terminalSessionAuthorityBoundaryId({ ...original, outcomeHighWatermark: 1 })).not.toBe(
      terminalSessionAuthorityBoundaryId(original)
    )
    expect(
      terminalSessionAuthorityBoundaryId({
        ...original,
        projection: { ...original.projection!, revision: 2 }
      })
    ).not.toBe(terminalSessionAuthorityBoundaryId(original))
  })

  it('normalizes omitted optional fields and ignores unknown top-level additions', () => {
    const {
      consumerStart: _consumerStart,
      projection: _projection,
      ...required
    } = unsignedBoundary()
    const absent = required satisfies UnsignedBoundary
    const explicit = { ...required, consumerStart: undefined, projection: undefined }
    const future = { ...required, futureOptional: 'ignored-by-v1' } as UnsignedBoundary

    expect(terminalSessionAuthorityBoundaryId(explicit)).toBe(
      terminalSessionAuthorityBoundaryId(absent)
    )
    expect(terminalSessionAuthorityBoundaryId(future)).toBe(
      terminalSessionAuthorityBoundaryId(absent)
    )
  })

  it('rejects another identity version instead of aliasing it into v1', () => {
    expect(() =>
      terminalSessionAuthorityBoundaryId({ ...unsignedBoundary(), version: 2 } as never)
    ).toThrow('version is invalid')
  })
})

function unsignedBoundary(): UnsignedBoundary {
  const namespace = Object.freeze({ authorityHostId: 'host-1', namespaceId: 'namespace-1' })
  return Object.freeze({
    version: 1,
    consumer: Object.freeze({
      consumerId: 'app-profile:one',
      consumerIncarnationId: 'app-process:one'
    }),
    namespace,
    acknowledgedSequence: 0,
    outcomeHighWatermark: 0,
    consumerStart: 'new-at-tail',
    projection: Object.freeze({
      namespace,
      writerEpoch: 1,
      revision: 1,
      panes: Object.freeze([]),
      allocations: Object.freeze([]),
      materializedOutcomes: Object.freeze([])
    })
  })
}
