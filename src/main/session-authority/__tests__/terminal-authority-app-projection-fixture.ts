import {
  TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_VERSION,
  type TerminalAuthorityNamespaceOutcomeBoundary,
  type TerminalAuthorityNamespaceOutcomePublication,
  type TerminalAuthorityPolicyConsumerIdentity
} from '../../../shared/terminal-session-authority-consumer-transport'
import type {
  TerminalAuthorityProjection,
  TerminalSessionAuthoritySemanticFact
} from '../../../shared/terminal-session-authority-mutation'
import { terminalAuthorityOutcomeByteLength } from '../../../shared/terminal-session-authority-record-validation'
import { terminalSessionAuthorityBoundaryId } from '../../../shared/terminal-session-authority-boundary-identity'

export const APP_CONSUMER = Object.freeze({
  consumerId: 'app-profile:v1:test-profile',
  consumerIncarnationId: 'app-process:test-process'
})

export const NEXT_APP_CONSUMER = Object.freeze({
  consumerId: APP_CONSUMER.consumerId,
  consumerIncarnationId: 'app-process:next-process'
})

export const NAMESPACE = Object.freeze({
  authorityHostId: 'host-1',
  namespaceId: 'namespace-1'
})

export const PANE_KEY = 'tab-1:11111111-1111-4111-8111-111111111111'

export function authorityProjection(
  options: {
    namespaceId?: string
    revision?: number
    paneGenerationId?: string
    bound?: boolean
    panes?: TerminalAuthorityProjection['panes']
    materializedOutcomes?: TerminalAuthorityProjection['materializedOutcomes']
  } = {}
): TerminalAuthorityProjection {
  const namespace = Object.freeze({
    ...NAMESPACE,
    ...(options.namespaceId ? { namespaceId: options.namespaceId } : {})
  })
  const binding = {
    ownerIncarnationId: 'owner-1',
    physicalPtyId: 'pty-1',
    ptyIncarnationId: 'pty-incarnation-1'
  }
  return Object.freeze({
    namespace,
    writerEpoch: 1,
    revision: options.revision ?? 1,
    panes: Object.freeze(
      options.panes ?? [
        Object.freeze({
          paneKey: PANE_KEY,
          paneGenerationId: options.paneGenerationId ?? 'pane-generation-1',
          status: 'open' as const,
          binding: options.bound === false ? null : binding,
          lastBinding: options.bound === false ? null : binding,
          revision: options.revision ?? 1,
          ownerStatus: options.bound === false ? null : ('reachable' as const)
        })
      ]
    ),
    allocations: Object.freeze([]),
    materializedOutcomes: Object.freeze(options.materializedOutcomes ?? [])
  })
}

export function boundary(
  acknowledgedSequence: number,
  options: {
    consumer?: TerminalAuthorityPolicyConsumerIdentity
    namespaceId?: string
    outcomeHighWatermark?: number
    projection?: TerminalAuthorityProjection
    consumerStart?: TerminalAuthorityNamespaceOutcomeBoundary['consumerStart']
  } = {}
): TerminalAuthorityNamespaceOutcomeBoundary {
  const value: Omit<TerminalAuthorityNamespaceOutcomeBoundary, 'boundaryId'> = {
    version: TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_VERSION,
    consumer: options.consumer ?? APP_CONSUMER,
    namespace: Object.freeze({
      ...NAMESPACE,
      ...(options.namespaceId ? { namespaceId: options.namespaceId } : {})
    }),
    acknowledgedSequence,
    outcomeHighWatermark: options.outcomeHighWatermark ?? acknowledgedSequence,
    consumerStart: options.consumerStart ?? 'new-at-tail',
    projection:
      options.projection ??
      authorityProjection({
        namespaceId: options.namespaceId,
        revision: Math.max(1, acknowledgedSequence)
      })
  }
  return Object.freeze({ ...value, boundaryId: terminalSessionAuthorityBoundaryId(value) })
}

export function semanticPublication(
  sequence: number,
  fact: TerminalSessionAuthoritySemanticFact = { kind: 'bell' },
  options: {
    consumer?: TerminalAuthorityPolicyConsumerIdentity
    namespaceId?: string
    paneGenerationId?: string
    ptyIncarnationId?: string
    outcomeId?: string
  } = {}
): TerminalAuthorityNamespaceOutcomePublication {
  const namespace = Object.freeze({
    ...NAMESPACE,
    ...(options.namespaceId ? { namespaceId: options.namespaceId } : {})
  })
  const paneGenerationId = options.paneGenerationId ?? 'pane-generation-1'
  const ptyIncarnationId = options.ptyIncarnationId ?? 'pty-incarnation-1'
  const base = {
    kind: 'semantic' as const,
    sequence,
    outcomeId: options.outcomeId ?? `semantic-${namespace.namespaceId}-${sequence}`,
    access: {
      namespace,
      pane: { paneKey: PANE_KEY, paneGenerationId },
      binding: {
        ownerIncarnationId: 'owner-1',
        physicalPtyId: 'pty-1',
        ptyIncarnationId
      }
    },
    producerIncarnationId: 'producer-1',
    producerSequence: sequence,
    fact,
    appendedAtRevision: sequence
  }
  const outcome = Object.freeze({ ...base, byteLength: terminalAuthorityOutcomeByteLength(base) })
  return Object.freeze({
    version: TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_VERSION,
    consumer: options.consumer ?? APP_CONSUMER,
    namespace,
    previousSequence: sequence - 1,
    outcome
  })
}

export function exitPublication(
  sequence: number,
  options: { consumer?: TerminalAuthorityPolicyConsumerIdentity; paneGenerationId?: string } = {}
): TerminalAuthorityNamespaceOutcomePublication {
  const paneGenerationId = options.paneGenerationId ?? 'pane-generation-1'
  const binding = {
    ownerIncarnationId: 'owner-1',
    physicalPtyId: 'pty-1',
    ptyIncarnationId: `pty-incarnation-${paneGenerationId}`
  }
  const pane = { paneKey: PANE_KEY, paneGenerationId }
  const base = {
    sequence,
    outcomeId: `exit-${paneGenerationId}-${sequence}`,
    request: {
      actorId: 'actor-1',
      operationId: `exit-operation-${sequence}`,
      baseRevision: sequence,
      outcomeId: `exit-${paneGenerationId}-${sequence}`,
      change: {
        kind: 'exit' as const,
        pane,
        expected: { paneGenerationId, binding },
        exit: { code: 17, signal: null }
      }
    },
    result: {
      namespace: NAMESPACE,
      actorId: 'actor-1',
      operationId: `exit-operation-${sequence}`,
      kind: 'exit' as const,
      revision: sequence + 1,
      pane: {
        ...pane,
        status: 'exited' as const,
        binding: null,
        lastBinding: binding,
        revision: sequence + 1
      },
      replacementPane: null,
      allocation: null,
      effects: [{ kind: 'terminal-exited' as const, binding, code: 17, signal: null }]
    }
  }
  const outcome = Object.freeze({ ...base, byteLength: terminalAuthorityOutcomeByteLength(base) })
  return Object.freeze({
    version: TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_VERSION,
    consumer: options.consumer ?? APP_CONSUMER,
    namespace: NAMESPACE,
    previousSequence: sequence - 1,
    outcome
  })
}
