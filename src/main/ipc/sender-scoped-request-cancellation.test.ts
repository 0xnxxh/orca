import { describe, expect, it } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import { createSenderScopedRequestCancellations } from './sender-scoped-request-cancellation'

// Why: only `sender` identity matters here; the rest of the invoke event is unused.
const eventFor = (sender: object): IpcMainInvokeEvent => ({ sender }) as IpcMainInvokeEvent

describe('createSenderScopedRequestCancellations', () => {
  it('aborts the previous request when one sender reuses a token', () => {
    const registry = createSenderScopedRequestCancellations()
    const event = eventFor({ id: 1 })

    const first = registry.begin(event, 'token')
    const second = registry.begin(event, 'token')

    expect(first?.signal.aborted).toBe(true)
    expect(second?.signal.aborted).toBe(false)
  })

  it('keeps two senders that share a token isolated', () => {
    const registry = createSenderScopedRequestCancellations()
    const senderA = { id: 1 }
    const senderB = { id: 2 }
    const first = registry.begin(eventFor(senderA), 'token')
    const second = registry.begin(eventFor(senderB), 'token')

    registry.cancel(eventFor(senderB), 'token')

    expect(first?.signal.aborted).toBe(false)
    expect(second?.signal.aborted).toBe(true)
  })

  it('does not let a recycled webContents id reach the previous renderer request', () => {
    const registry = createSenderScopedRequestCancellations()
    const closed = { id: 7 }
    const pending = registry.begin(eventFor(closed), 'token')

    // Electron recycles webContents ids, so a later renderer can present id 7 again.
    const recycled = { id: 7 }
    registry.cancel(eventFor(recycled), 'token')

    expect(pending?.signal.aborted).toBe(false)
  })

  it('does not let a recycled id replace the previous renderer registration', () => {
    const registry = createSenderScopedRequestCancellations()
    const pending = registry.begin(eventFor({ id: 7 }), 'token')

    const replacement = registry.begin(eventFor({ id: 7 }), 'token')

    expect(pending?.signal.aborted).toBe(false)
    expect(replacement?.signal.aborted).toBe(false)
  })

  it('ignores a finish from a recycled id holding a different controller', () => {
    const registry = createSenderScopedRequestCancellations()
    const sender = { id: 7 }
    const controller = registry.begin(eventFor(sender), 'token')

    registry.finish(eventFor({ id: 7 }), 'token', controller)
    registry.cancel(eventFor(sender), 'token')

    expect(controller?.signal.aborted).toBe(true)
  })

  it('drops the registration once its request settles', () => {
    const registry = createSenderScopedRequestCancellations()
    const sender = { id: 1 }
    const controller = registry.begin(eventFor(sender), 'token')

    registry.finish(eventFor(sender), 'token', controller)
    registry.cancel(eventFor(sender), 'token')

    expect(controller?.signal.aborted).toBe(false)
  })

  it('returns null without registering when the token is empty', () => {
    const registry = createSenderScopedRequestCancellations()
    expect(registry.begin(eventFor({ id: 1 }), undefined)).toBeNull()
    expect(registry.begin(eventFor({ id: 1 }), '')).toBeNull()
  })
})
