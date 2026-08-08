import {
  sameTerminalAuthorityPolicyConsumer,
  type TerminalAuthorityNamespaceBoundaryAcceptance,
  type TerminalAuthorityNamespaceOutcomeBoundary
} from '../../shared/terminal-session-authority-consumer-transport'
import { terminalSessionAuthorityBoundaryId } from '../../shared/terminal-session-authority-boundary-identity'

const DEFAULT_ACCEPTANCE_TIMEOUT_MS = 30_000
const MAX_ACCEPTED_BOUNDARIES = 4_096

type PendingAcceptance = Readonly<{
  boundary: TerminalAuthorityNamespaceOutcomeBoundary
  promise: Promise<void>
  resolve(): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}>

export class TerminalSessionAuthorityBoundaryAcceptances {
  private readonly pending = new Map<string, PendingAcceptance>()
  private readonly accepted = new Map<string, string>()
  private closed = false

  constructor(private readonly timeoutMs = DEFAULT_ACCEPTANCE_TIMEOUT_MS) {}

  wait(boundary: TerminalAuthorityNamespaceOutcomeBoundary): Promise<void> {
    this.assertBoundaryIdentity(boundary)
    if (this.closed) {
      return Promise.reject(new Error('terminal authority boundary transport is unavailable'))
    }
    const boundaryId = boundary.boundaryId!
    if (this.accepted.has(boundaryId)) {
      return Promise.resolve()
    }
    const existing = this.pending.get(boundaryId)
    if (existing) {
      return existing.promise
    }
    let resolve!: () => void
    let reject!: (error: Error) => void
    const promise = new Promise<void>((settle, fail) => {
      resolve = settle
      reject = fail
    })
    const timer = setTimeout(() => {
      this.pending.delete(boundaryId)
      reject(new Error('terminal authority boundary acceptance timed out'))
    }, this.timeoutMs)
    timer.unref?.()
    this.pending.set(boundaryId, { boundary, promise, resolve, reject, timer })
    return promise
  }

  accept(acceptance: TerminalAuthorityNamespaceBoundaryAcceptance): void {
    const key = acceptanceKey(acceptance)
    const accepted = this.accepted.get(acceptance.boundaryId)
    if (accepted) {
      if (accepted !== key) {
        throw new Error('terminal authority boundary acceptance conflicts')
      }
      return
    }
    const pending = this.pending.get(acceptance.boundaryId)
    if (!pending || !matchesBoundary(pending.boundary, acceptance)) {
      throw new Error('terminal authority boundary acceptance is unauthorized')
    }
    clearTimeout(pending.timer)
    this.pending.delete(acceptance.boundaryId)
    if (this.accepted.size >= MAX_ACCEPTED_BOUNDARIES) {
      pending.reject(new Error('terminal authority accepted boundary capacity is full'))
      throw new Error('terminal authority accepted boundary capacity is full')
    }
    this.accepted.set(acceptance.boundaryId, key)
    pending.resolve()
  }

  close(error = new Error('terminal authority boundary transport disconnected')): void {
    if (this.closed) {
      return
    }
    this.closed = true
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
    this.accepted.clear()
  }

  private assertBoundaryIdentity(boundary: TerminalAuthorityNamespaceOutcomeBoundary): void {
    const { boundaryId, ...unsigned } = boundary
    if (!boundaryId || terminalSessionAuthorityBoundaryId(unsigned) !== boundaryId) {
      throw new Error('terminal authority boundary identity is invalid')
    }
  }
}

function matchesBoundary(
  boundary: TerminalAuthorityNamespaceOutcomeBoundary,
  acceptance: TerminalAuthorityNamespaceBoundaryAcceptance
): boolean {
  return (
    boundary.boundaryId === acceptance.boundaryId &&
    sameTerminalAuthorityPolicyConsumer(boundary.consumer, acceptance.consumer) &&
    boundary.namespace.authorityHostId === acceptance.namespace.authorityHostId &&
    boundary.namespace.namespaceId === acceptance.namespace.namespaceId &&
    boundary.acknowledgedSequence === acceptance.acknowledgedSequence &&
    boundary.outcomeHighWatermark === acceptance.outcomeHighWatermark
  )
}

function acceptanceKey(acceptance: TerminalAuthorityNamespaceBoundaryAcceptance): string {
  return JSON.stringify([
    acceptance.consumer,
    acceptance.namespace,
    acceptance.acknowledgedSequence,
    acceptance.outcomeHighWatermark
  ])
}
