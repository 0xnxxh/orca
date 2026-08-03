import { useCallback } from 'react'
import type { TerminalLiveExternalInputRunner } from '../terminal/terminal-live-input-sender'

type CurrentRef<T> = { readonly current: T }

type AttachmentInputLeaseGateArgs = {
  readonly runTerminalLiveExternalInput: TerminalLiveExternalInputRunner
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
  runTerminalLiveExternalInput,
  connStateRef,
  activeHandleRef,
  activeSessionTabTypeRef,
  nativeChatInputLeaseReadyRef,
  showToast
}: AttachmentInputLeaseGateArgs): TerminalLiveExternalInputRunner {
  return useCallback(
    async (targetHandle, send) => {
      let inputCommitted = false
      const sent = await runTerminalLiveExternalInput(targetHandle, async () => {
        inputCommitted = true
        // Why: image picking/upload and IME flushing can outlive the original tab.
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
          return send()
        }
        showToast('Attach failed (reconnecting)', 1500)
        return false
      })
      if (!sent && !inputCommitted) {
        showToast('Attach canceled before send', 1500)
      }
      return sent
    },
    [
      activeHandleRef,
      activeSessionTabTypeRef,
      connStateRef,
      nativeChatInputLeaseReadyRef,
      runTerminalLiveExternalInput,
      showToast
    ]
  )
}
