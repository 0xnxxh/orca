import type { GitRepositorySnapshotSubscriptionEvent } from '../../../../shared/git-repository-snapshot'

function compareEvent(
  left: GitRepositorySnapshotSubscriptionEvent,
  right: GitRepositorySnapshotSubscriptionEvent
): number {
  return (
    left.incarnation - right.incarnation ||
    left.generation - right.generation ||
    left.revision - right.revision
  )
}

export class ChecksPanelRepositorySnapshotRevisionGate {
  private floor: GitRepositorySnapshotSubscriptionEvent | null = null
  private pending: GitRepositorySnapshotSubscriptionEvent | null = null
  private inFlight = false
  private invalidatedDuringFlight = false
  private refreshRequested = false
  private readSequence = 0
  private activeRead: number | null = null

  reset(): void {
    this.readSequence += 1
    this.activeRead = null
    this.floor = null
    this.pending = null
    this.inFlight = false
    this.invalidatedDuringFlight = false
    this.refreshRequested = false
  }

  begin(): number {
    this.readSequence += 1
    this.activeRead = this.readSequence
    this.inFlight = true
    this.invalidatedDuringFlight = false
    this.refreshRequested = false
    return this.readSequence
  }

  observe(event: GitRepositorySnapshotSubscriptionEvent): boolean {
    if (this.floor && compareEvent(event, this.floor) <= 0) {
      return false
    }
    this.floor = event
    if (event.state === 'invalidated') {
      if (this.inFlight) {
        this.invalidatedDuringFlight = true
      }
      if (this.pending && compareEvent(this.pending, event) <= 0) {
        this.pending = null
      }
      return false
    }
    if (!this.pending || compareEvent(event, this.pending) > 0) {
      this.pending = event
    }
    if (this.inFlight || this.refreshRequested) {
      return false
    }
    this.refreshRequested = true
    return true
  }

  finish(read: number, observedRevision: number | null): boolean {
    if (this.activeRead !== read) {
      return false
    }
    this.activeRead = null
    this.inFlight = false
    const pending = this.pending
    if (
      !pending ||
      (!this.invalidatedDuringFlight &&
        observedRevision !== null &&
        observedRevision >= pending.revision)
    ) {
      this.pending = null
      this.invalidatedDuringFlight = false
      return false
    }
    this.invalidatedDuringFlight = false
    if (this.refreshRequested) {
      return false
    }
    this.refreshRequested = true
    return true
  }
}
