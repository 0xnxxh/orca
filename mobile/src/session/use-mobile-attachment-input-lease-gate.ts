import { useCallback } from 'react'

type CurrentRef<T> = { readonly current: T }

type AttachmentInputLeaseGateArgs = {
  readonly flushPendingLiveInputBeforeExternalSend: (handle: string) => Promise<boolean>
  readonly connStateRef: CurrentRef<string>
  readonly activeHandleRef: CurrentRef<string | null>
  readonly activeSessionTabTypeRef: CurrentRef<string | null>
  readonly nativeChatInputLeaseReadyRef: CurrentRef<boolean>
  readonly showToast: (message: string, durationMs?: number) => void
}

// Poll cadence + ceiling for riding out a terminal resubscribe (WS reconnect or
// return-to-terminal) during which the input lease is briefly not ready.
const LEASE_READY_POLL_MS = 100
const LEASE_READY_TIMEOUT_MS = 3000

/** Gates an image attachment's terminal.send on committed input and a ready lease. */
export function useMobileAttachmentInputLeaseGate({
  flushPendingLiveInputBeforeExternalSend,
  connStateRef,
  activeHandleRef,
  activeSessionTabTypeRef,
  nativeChatInputLeaseReadyRef,
  showToast
}: AttachmentInputLeaseGateArgs): (targetHandle: string) => Promise<boolean> {
  return useCallback(
    async (targetHandle: string): Promise<boolean> => {
      const flushedPendingInput = await flushPendingLiveInputBeforeExternalSend(targetHandle)
      // Why: image picking/upload and IME flushing can outlive the original tab.
      if (!flushedPendingInput) {
        showToast('Attach canceled before send', 1500)
        return false
      }
      if (
        connStateRef.current !== 'connected' ||
        targetHandle !== activeHandleRef.current ||
        activeSessionTabTypeRef.current !== 'terminal'
      ) {
        showToast('Attach canceled before send', 1500)
        return false
      }
      const deadline = Date.now() + LEASE_READY_TIMEOUT_MS
      while (!nativeChatInputLeaseReadyRef.current && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, LEASE_READY_POLL_MS))
      }
      // Why: the wait can outlive the target too — re-check so a tab/host switch
      // or disconnect mid-wait doesn't send into the wrong (or dead) terminal.
      if (
        connStateRef.current !== 'connected' ||
        targetHandle !== activeHandleRef.current ||
        activeSessionTabTypeRef.current !== 'terminal'
      ) {
        showToast('Attach canceled before send', 1500)
        return false
      }
      if (nativeChatInputLeaseReadyRef.current) {
        return true
      }
      showToast('Attach failed (reconnecting)', 1500)
      return false
    },
    [
      activeHandleRef,
      activeSessionTabTypeRef,
      connStateRef,
      flushPendingLiveInputBeforeExternalSend,
      nativeChatInputLeaseReadyRef,
      showToast
    ]
  )
}
