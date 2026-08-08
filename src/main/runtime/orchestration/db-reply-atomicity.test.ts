import { afterEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from './db'

describe('OrchestrationDb reply atomicity', () => {
  let db: OrchestrationDb | undefined

  afterEach(() => {
    db?.close()
  })

  function createDb(): OrchestrationDb {
    db = new OrchestrationDb(':memory:')
    return db
  }

  it('commits the reply and the consumption of the original together', () => {
    const d = createDb()
    const original = d.insertMessage({ from: 'term_a', to: 'term_b', subject: 'ping' })

    const reply = d.insertReplyAndMarkOriginalRead(original.id, {
      from: 'term_b',
      to: 'term_a',
      subject: 'Re: ping',
      body: 'pong',
      threadId: original.id
    })

    expect(d.getMessageById(reply.id)?.body).toBe('pong')
    expect(d.getMessageById(original.id)?.read).toBe(1)
  })

  it('leaves the original unread when the reply insert fails', () => {
    const d = createDb()
    const original = d.insertMessage({ from: 'term_a', to: 'term_b', subject: 'ping' })

    expect(() =>
      d.insertReplyAndMarkOriginalRead(original.id, {
        from: 'term_b',
        to: 'term_a',
        subject: 'Re: ping',
        body: 'pong',
        threadId: original.id,
        runId: 'run_does_not_exist'
      })
    ).toThrow()

    // Why: consuming the original without persisting the reply would strand the answer with nothing unread left to retry from.
    expect(d.getMessageById(original.id)?.read).toBe(0)
    expect(d.getInbox(10)).toHaveLength(1)
  })
})
