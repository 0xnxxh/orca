import { failTerminalSessionAuthority } from '../../shared/terminal-session-authority-mutation'
import type { TerminalSessionAuthorityState } from '../../shared/terminal-session-authority-state'
import type {
  TerminalAuthorityObserverAccess,
  TerminalAuthorityRuntimeAccess
} from './terminal-session-authority-access'
import type {
  TerminalAuthorityProjectionChange,
  TerminalAuthorityProjectionListener
} from './terminal-session-authority-service-contract'

export class TerminalAuthorityProjectionSubscriptions {
  private readonly listeners = new Map<string, TerminalAuthorityProjectionListener>()

  constructor(
    private readonly state: TerminalSessionAuthorityState,
    private readonly accesses: TerminalAuthorityRuntimeAccess
  ) {}

  observe(actorId: string): TerminalAuthorityObserverAccess {
    return this.accesses.observe(actorId)
  }

  subscribe(
    actorId: string,
    listener: TerminalAuthorityProjectionListener
  ): TerminalAuthorityObserverAccess {
    if (typeof listener !== 'function') {
      failTerminalSessionAuthority('expectation-mismatch', 'projection listener is invalid')
    }
    const access = this.accesses.observe(actorId)
    this.listeners.set(access.accessId, listener)
    return access
  }

  revoke(access: TerminalAuthorityObserverAccess): void {
    this.accesses.revokeObserver(access)
    this.listeners.delete(access.accessId)
  }

  publish(reason: TerminalAuthorityProjectionChange['reason']): void {
    if (this.listeners.size === 0) {
      return
    }
    const change = Object.freeze({ reason, projection: this.state.projection() })
    for (const accessId of Array.from(this.listeners.keys())) {
      const listener = this.listeners.get(accessId)
      if (!listener) {
        continue
      }
      try {
        listener(change)
      } catch {
        // Subscriber failure cannot roll back durable authority state.
      }
    }
  }

  clear(): void {
    this.listeners.clear()
  }
}
