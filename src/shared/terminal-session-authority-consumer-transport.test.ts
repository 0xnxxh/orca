import { describe, expect, it } from 'vitest'
import type { TerminalAuthorityDurableOutcome } from './terminal-session-authority-mutation'
import { terminalAuthorityOutcomeByteLength } from './terminal-session-authority-record-validation'
import {
  parseTerminalAuthorityNamespaceOutcomeBoundary,
  type TerminalAuthorityNamespaceOutcomeBoundary
} from './terminal-session-authority-consumer-transport'

const namespace = Object.freeze({ authorityHostId: 'host-1', namespaceId: 'namespace-1' })

describe('parseTerminalAuthorityNamespaceOutcomeBoundary', () => {
  it('accepts an authenticated projection at its exact namespace and high-water mark', () => {
    expect(parseTerminalAuthorityNamespaceOutcomeBoundary(boundary())).toEqual(boundary())
  })

  it('rejects a projection from another namespace', () => {
    const value = boundary()
    const projection = {
      ...value.projection!,
      namespace: { ...namespace, namespaceId: 'namespace-2' }
    }

    expect(parseTerminalAuthorityNamespaceOutcomeBoundary({ ...value, projection })).toBeNull()
  })

  it('rejects materialized outcomes newer than the authenticated high-water mark', () => {
    const value = boundary()
    const projection = { ...value.projection!, materializedOutcomes: [semanticOutcome(8)] }

    expect(parseTerminalAuthorityNamespaceOutcomeBoundary({ ...value, projection })).toBeNull()
  })
})

function boundary(): TerminalAuthorityNamespaceOutcomeBoundary {
  return Object.freeze({
    version: 1,
    consumer: Object.freeze({
      consumerId: 'app-profile:test',
      consumerIncarnationId: 'app-process:test'
    }),
    namespace,
    acknowledgedSequence: 7,
    outcomeHighWatermark: 7,
    boundaryId: 'boundary-1',
    consumerStart: 'new-at-tail',
    projection: Object.freeze({
      namespace,
      writerEpoch: 1,
      revision: 7,
      panes: Object.freeze([]),
      allocations: Object.freeze([]),
      materializedOutcomes: Object.freeze([])
    })
  })
}

function semanticOutcome(sequence: number): TerminalAuthorityDurableOutcome {
  const base = {
    kind: 'semantic' as const,
    sequence,
    outcomeId: `semantic-${sequence}`,
    access: {
      namespace,
      pane: { paneKey: 'pane-1', paneGenerationId: 'generation-1' },
      binding: {
        ownerIncarnationId: 'owner-1',
        physicalPtyId: 'pty-1',
        ptyIncarnationId: 'pty-incarnation-1'
      }
    },
    producerIncarnationId: 'producer-1',
    producerSequence: sequence,
    fact: { kind: 'bell' as const },
    appendedAtRevision: sequence
  }
  return Object.freeze({ ...base, byteLength: terminalAuthorityOutcomeByteLength(base) })
}
