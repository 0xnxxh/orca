import {
  TerminalSessionAuthorityError,
  type TerminalSessionAuthorityLogEvent,
  type TerminalSessionAuthoritySnapshot
} from '../../shared/terminal-session-authority-mutation'
import type { TerminalSessionAuthorityState } from '../../shared/terminal-session-authority-state'
import type { TerminalAuthorityFileStore } from './terminal-session-authority-file-store'

export class TerminalAuthorityMutationPersistence {
  constructor(
    private readonly state: TerminalSessionAuthorityState,
    private readonly store: TerminalAuthorityFileStore,
    private readonly onCrash: () => void
  ) {}

  async append(event: TerminalSessionAuthorityLogEvent): Promise<void> {
    try {
      await this.store.append(event)
    } catch (error) {
      // Definitely not durable: the record never reached the log, so callers may unwind in memory.
      if (!(error instanceof TerminalSessionAuthorityError && error.code === 'capacity')) {
        this.onCrash()
      }
      throw error
    }
    try {
      this.state.applyEvent(event)
      if (this.store.shouldCompact) {
        await this.store.compact(this.state.snapshot())
      }
    } catch (error) {
      // The record is already durable, so this is ambiguous rather than failed: fence the service and
      // let recovery reopen from the log instead of rewinding a write that landed.
      this.onCrash()
      throw error
    }
  }

  async compact(snapshot: TerminalSessionAuthoritySnapshot): Promise<void> {
    try {
      await this.store.compact(snapshot)
    } catch (error) {
      this.onCrash()
      throw error
    }
  }

  assertWriterCurrent(): Promise<void> {
    return this.store.assertWriterCurrent()
  }

  close(): Promise<void> {
    return this.store.close()
  }
}
