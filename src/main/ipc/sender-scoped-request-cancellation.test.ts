import { EventEmitter } from 'node:events'
import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it } from 'vitest'
import { createSenderScopedRequestCancellations } from './sender-scoped-request-cancellation'

class FakeSender extends EventEmitter {
  private destroyed: boolean

  constructor(
    readonly id: number,
    destroyed = false
  ) {
    super()
    this.destroyed = destroyed
  }

  isDestroyed(): boolean {
    return this.destroyed
  }

  destroy(): void {
    this.destroyed = true
    this.emit('destroyed')
  }
}

function eventFor(sender: FakeSender): IpcMainInvokeEvent {
  return { sender } as unknown as IpcMainInvokeEvent
}

describe('sender-scoped request cancellation', () => {
  it('aborts every request from a destroyed sender without affecting another sender', () => {
    const requests = createSenderScopedRequestCancellations()
    const firstSender = new FakeSender(1)
    const secondSender = new FakeSender(2)
    const first = requests.begin(eventFor(firstSender), 'first')
    const second = requests.begin(eventFor(firstSender), 'second')
    const other = requests.begin(eventFor(secondSender), 'other')

    firstSender.destroy()

    expect(first?.signal.aborted).toBe(true)
    expect(second?.signal.aborted).toBe(true)
    expect(other?.signal.aborted).toBe(false)
  })

  it('isolates distinct senders that reuse the same numeric id and token', () => {
    const requests = createSenderScopedRequestCancellations()
    const firstSender = new FakeSender(1)
    const secondSender = new FakeSender(1)
    const firstEvent = eventFor(firstSender)
    const secondEvent = eventFor(secondSender)
    const first = requests.begin(firstEvent, 'shared-token')
    const second = requests.begin(secondEvent, 'shared-token')

    expect(first?.signal.aborted).toBe(false)
    expect(second?.signal.aborted).toBe(false)

    firstSender.destroy()

    expect(first?.signal.aborted).toBe(true)
    expect(second?.signal.aborted).toBe(false)

    requests.cancel(secondEvent, 'shared-token')
    expect(second?.signal.aborted).toBe(true)
  })

  it('instance-fences finish after the same sender reuses a token', () => {
    const requests = createSenderScopedRequestCancellations()
    const event = eventFor(new FakeSender(1))
    const first = requests.begin(event, 'reused-token')
    const replacement = requests.begin(event, 'reused-token')

    expect(first?.signal.aborted).toBe(true)
    expect(replacement?.signal.aborted).toBe(false)

    requests.finish(event, 'reused-token', first)
    requests.cancel(event, 'reused-token')

    expect(replacement?.signal.aborted).toBe(true)
  })

  it('registers a replacement before abort cleanup runs synchronously', () => {
    const requests = createSenderScopedRequestCancellations()
    const sender = new FakeSender(1)
    const event = eventFor(sender)
    const first = requests.begin(event, 'reused-token')
    first?.signal.addEventListener('abort', () => {
      requests.finish(event, 'reused-token', first)
    })

    const replacement = requests.begin(event, 'reused-token')
    requests.cancel(event, 'reused-token')

    expect(replacement?.signal.aborted).toBe(true)
    expect(sender.listenerCount('destroyed')).toBe(1)

    requests.finish(event, 'reused-token', replacement)
    expect(sender.listenerCount('destroyed')).toBe(0)
  })

  it('removes the destroyed listener after the last request finishes', () => {
    const requests = createSenderScopedRequestCancellations()
    const sender = new FakeSender(1)
    const event = eventFor(sender)
    const first = requests.begin(event, 'first')
    const second = requests.begin(event, 'second')

    expect(sender.listenerCount('destroyed')).toBe(1)

    requests.finish(event, 'first', first)
    expect(sender.listenerCount('destroyed')).toBe(1)

    requests.finish(event, 'second', second)
    expect(sender.listenerCount('destroyed')).toBe(0)
  })

  it('immediately aborts a request begun by an already-destroyed sender', () => {
    const requests = createSenderScopedRequestCancellations()
    const sender = new FakeSender(1, true)

    const controller = requests.begin(eventFor(sender), 'late-request')

    expect(controller?.signal.aborted).toBe(true)
    expect(sender.listenerCount('destroyed')).toBe(0)
  })
})
