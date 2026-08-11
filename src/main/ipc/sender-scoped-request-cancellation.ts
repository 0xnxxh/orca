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
 * request, and reusing a token aborts the previous request before the new one
 * registers.
 */
export function createSenderScopedRequestCancellations(): SenderScopedRequestCancellations {
  type Sender = IpcMainInvokeEvent['sender']
  // Why: webContents ids are recycled once a window closes, so an id-derived key
  // can hand a new renderer the registration slot of a previous one.
  const controllersBySender = new WeakMap<Sender, Map<string, AbortController>>()
  const controllersFor = (sender: Sender): Map<string, AbortController> => {
    const existing = controllersBySender.get(sender)
    if (existing) {
      return existing
    }
    const created = new Map<string, AbortController>()
    controllersBySender.set(sender, created)
    return created
  }
  return {
    begin: (event, requestToken) => {
      if (!requestToken) {
        return null
      }
      const controllers = controllersFor(event.sender)
      controllers.get(requestToken)?.abort()
      const controller = new AbortController()
      controllers.set(requestToken, controller)
      return controller
    },
    finish: (event, requestToken, controller) => {
      if (!requestToken || !controller) {
        return
      }
      const controllers = controllersBySender.get(event.sender)
      if (controllers?.get(requestToken) === controller) {
        controllers.delete(requestToken)
      }
    },
    cancel: (event, requestToken) => {
      controllersBySender.get(event.sender)?.get(requestToken)?.abort()
    }
  }
}
