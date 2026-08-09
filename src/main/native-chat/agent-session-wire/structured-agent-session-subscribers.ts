// Per-subscriber cursors over one session's journal.
//
// Each subscriber advances independently: a client that connected two epochs
// ago gets a reset while a caught-up one gets a batch from the same publish.
// Nothing raw reaches a subscriber — every event carries reducer output.

import type {
  AgentJournalCursor,
  AgentJournalResetReason
} from '../../../shared/agent-session-journal-types'
import type { AgentSessionSubscribeEvent } from '../../../shared/agent-session-wire'
import type { AgentSessionJournal } from '../agent-session-journal/journal-store'
import { projectJournalBatch } from './agent-session-journal-batch'

export type AgentSessionSubscriberEmit = (event: AgentSessionSubscribeEvent) => void

type Subscriber = {
  id: string
  sessionId: string
  emit: AgentSessionSubscriberEmit
  cursor: AgentJournalCursor
}

export class AgentSessionSubscribers {
  private readonly bySession = new Map<string, Map<string, Subscriber>>()

  /** Opens the stream with a snapshot or, when the client's cursor still
   *  resolves, with the rows it missed. Returns the disposer. */
  open(input: {
    id: string
    sessionId: string
    journal: AgentSessionJournal
    fence: number
    emit: AgentSessionSubscriberEmit
    cursor?: AgentJournalCursor
  }): () => void {
    const snapshot = input.journal.snapshot()
    const subscriber: Subscriber = {
      id: input.id,
      sessionId: input.sessionId,
      emit: input.emit,
      cursor: input.cursor ?? { epoch: snapshot.cursor.epoch, sequence: 0 }
    }
    const session = this.bySession.get(input.sessionId) ?? new Map<string, Subscriber>()
    session.set(input.id, subscriber)
    this.bySession.set(input.sessionId, session)

    if (input.cursor) {
      this.deliver(subscriber, input.journal)
    } else {
      subscriber.emit({
        type: 'snapshot',
        sessionId: input.sessionId,
        snapshot,
        fence: input.fence
      })
      subscriber.cursor = snapshot.cursor
    }
    return () => this.close(input.sessionId, input.id)
  }

  close(sessionId: string, id: string): void {
    const session = this.bySession.get(sessionId)
    const subscriber = session?.get(id)
    if (!session || !subscriber) {
      return
    }
    session.delete(id)
    if (session.size === 0) {
      this.bySession.delete(sessionId)
    }
    subscriber.emit({ type: 'end' })
  }

  /** Fan out whatever each subscriber has not yet seen. */
  publish(sessionId: string, journal: AgentSessionJournal): void {
    for (const subscriber of this.subscribers(sessionId)) {
      this.deliver(subscriber, journal)
    }
  }

  /** Force every subscriber back to a clean snapshot — recovery, epoch
   *  rollover, an unreadable schema. */
  reset(sessionId: string, journal: AgentSessionJournal, reason: AgentJournalResetReason): void {
    const snapshot = journal.snapshot()
    for (const subscriber of this.subscribers(sessionId)) {
      subscriber.emit({ type: 'reset', sessionId, reset: reason, snapshot })
      subscriber.cursor = snapshot.cursor
    }
  }

  private subscribers(sessionId: string): Subscriber[] {
    return [...(this.bySession.get(sessionId)?.values() ?? [])]
  }

  private deliver(subscriber: Subscriber, journal: AgentSessionJournal): void {
    const since = journal.readSince(subscriber.cursor)
    const snapshot = journal.snapshot()
    if (!since.ok) {
      subscriber.emit({
        type: 'reset',
        sessionId: subscriber.sessionId,
        reset: since.reset,
        snapshot
      })
      subscriber.cursor = snapshot.cursor
      return
    }
    if (since.rows.length === 0) {
      return
    }
    const projected = projectJournalBatch({
      rows: since.rows,
      snapshot,
      afterSequence: subscriber.cursor.sequence
    })
    if (!projected.ok) {
      subscriber.emit({
        type: 'reset',
        sessionId: subscriber.sessionId,
        reset: projected.reset,
        snapshot
      })
      subscriber.cursor = snapshot.cursor
      return
    }
    subscriber.emit({ type: 'batch', sessionId: subscriber.sessionId, batch: projected.batch })
    subscriber.cursor = projected.batch.cursor
  }
}
