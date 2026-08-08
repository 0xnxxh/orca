import type {
  TerminalAuthorityAppEventKey,
  TerminalAuthorityAppProjectionChange
} from '../../shared/terminal-authority-app-projection'
import type { TerminalAuthorityNamespace } from '../../shared/terminal-session-authority-identity'
import type {
  TerminalAuthorityNamespaceOutcomeBoundary,
  TerminalAuthorityNamespaceOutcomePublication
} from '../../shared/terminal-session-authority-consumer-transport'
import type { TerminalAuthorityProjection } from '../../shared/terminal-session-authority-mutation'
import { terminalAuthorityDurableOutcomeNamespace } from '../../shared/terminal-authority-durable-outcome-validation'
import { assertAuthorityId } from '../../shared/terminal-session-authority-identity'

export function assertTerminalAuthorityAppProjectionPublicationPage(
  publication: TerminalAuthorityNamespaceOutcomePublication
): void {
  assertAuthorityId(publication.consumer.consumerId, 'app projection consumerId')
  const outcomes = publication.outcomes ?? [publication.outcome]
  outcomes.forEach((outcome, index) => {
    if (
      outcome.sequence !== publication.previousSequence + index + 1 ||
      !sameNamespace(terminalAuthorityDurableOutcomeNamespace(outcome), publication.namespace)
    ) {
      throw new Error('terminal authority app projection publication has a cursor gap')
    }
  })
}

export function requireTerminalAuthorityAppBoundaryProjection(
  boundary: TerminalAuthorityNamespaceOutcomeBoundary
): TerminalAuthorityProjection {
  const projection = boundary.projection
  if (
    !projection ||
    projection.materializedOutcomes === undefined ||
    projection.materializedOutcomes.some(
      (outcome) => outcome.sequence > boundary.outcomeHighWatermark
    ) ||
    !sameNamespace(projection.namespace, boundary.namespace)
  ) {
    throw new Error('terminal authority app projection boundary is missing its authority snapshot')
  }
  return projection
}

export function sameTerminalAuthorityAppEvent(
  left: TerminalAuthorityAppEventKey,
  right: TerminalAuthorityAppEventKey
): boolean {
  return (
    left.consumerId === right.consumerId &&
    sameNamespace(left.namespace, right.namespace) &&
    left.sequence === right.sequence &&
    left.outcomeId === right.outcomeId
  )
}

export function terminalAuthorityAppProjectionLimit(
  value: number | undefined,
  fallback: number
): number {
  const selected = value ?? fallback
  if (!Number.isSafeInteger(selected) || selected < 1) {
    throw new Error('terminal authority app projection limit is invalid')
  }
  return selected
}

export function emptyTerminalAuthorityAppProjectionChange(): TerminalAuthorityAppProjectionChange {
  return Object.freeze({ rows: Object.freeze([]), deleted: Object.freeze([]) })
}

function sameNamespace(
  left: TerminalAuthorityNamespace,
  right: TerminalAuthorityNamespace
): boolean {
  return left.authorityHostId === right.authorityHostId && left.namespaceId === right.namespaceId
}
