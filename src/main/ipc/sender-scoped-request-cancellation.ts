import type { IpcMainInvokeEvent } from 'electron'

export type SenderScopedRequestCancellations = {
  /** Registers a cancellable request; aborts any previous request that reused the token. */
  begin: (event: IpcMainInvokeEvent, requestToken: string | undefined) => AbortController | null
  /** Removes the registration once the request settles (no-op if it was replaced). */
  finish: (
    event: IpcMainInvokeEvent,
    requestToken: string | undefined,
    controller: AbortController | null
  ) => void
  /** Best-effort abort from the issuing webContents; a settled request is gone. */
  cancel: (event: IpcMainInvokeEvent, requestToken: string) => void
}

/**
 * Registry for renderer-cancellable IPC requests. Keys are scoped to the
 * issuing webContents so one window's token can never cancel another window's
 * request, and reusing a token keeps only the newest request registered.
 */
export function createSenderScopedRequestCancellations(): SenderScopedRequestCancellations {
  type Sender = IpcMainInvokeEvent['sender']
  type SenderRequests = {
    controllers: Map<string, AbortController>
    onDestroyed: () => void
  }

  const requestsBySender = new WeakMap<Sender, SenderRequests>()

  const releaseSender = (sender: Sender, requests: SenderRequests): void => {
    if (requestsBySender.get(sender) !== requests) {
      return
    }
    requestsBySender.delete(sender)
    const senderLifecycle = sender as Partial<Sender>
    senderLifecycle.removeListener?.('destroyed', requests.onDestroyed)
  }

  const getOrCreateSenderRequests = (sender: Sender): SenderRequests => {
    const existing = requestsBySender.get(sender)
    if (existing) {
      return existing
    }
    const requests: SenderRequests = {
      controllers: new Map(),
      onDestroyed: () => {
        if (requestsBySender.get(sender) !== requests) {
          return
        }
        requestsBySender.delete(sender)
        const senderLifecycle = sender as Partial<Sender>
        senderLifecycle.removeListener?.('destroyed', requests.onDestroyed)
        for (const controller of requests.controllers.values()) {
          controller.abort()
        }
        requests.controllers.clear()
      }
    }
    requestsBySender.set(sender, requests)
    const senderLifecycle = sender as Partial<Sender>
    senderLifecycle.once?.('destroyed', requests.onDestroyed)
    return requests
  }

  return {
    begin: (event, requestToken) => {
      if (!requestToken) {
        return null
      }
      const requests = getOrCreateSenderRequests(event.sender)
      const previous = requests.controllers.get(requestToken)
      const controller = new AbortController()
      requests.controllers.set(requestToken, controller)
      previous?.abort()
      // Why: destruction can win before the IPC handler begins on a queued event.
      const senderLifecycle = event.sender as Partial<Sender>
      if (senderLifecycle.isDestroyed?.()) {
        requests.onDestroyed()
      }
      return controller
    },
    finish: (event, requestToken, controller) => {
      if (!requestToken || !controller) {
        return
      }
      const requests = requestsBySender.get(event.sender)
      if (requests?.controllers.get(requestToken) === controller) {
        requests.controllers.delete(requestToken)
        if (requests.controllers.size === 0) {
          releaseSender(event.sender, requests)
        }
      }
    },
    cancel: (event, requestToken) => {
      requestsBySender.get(event.sender)?.controllers.get(requestToken)?.abort()
    }
  }
}
