import type { RpcClient } from '../transport/rpc-client'
import type { RpcFailure, RpcSuccess } from '../transport/types'
import { buildTerminalSendParams } from '../terminal/terminal-send-request'

type CreatedTerminalPromptDeliveryOptions = {
  client: RpcClient
  terminal: string
  text?: string
  enter?: boolean
  deviceToken: string | null
  successToast?: string
  errorToast?: string
  onDelivered?: () => void
  shouldReport?: () => boolean
  onSuccess: () => void
  onError: () => void
  showToast: (message: string, durationMs?: number) => void
}

export function deliverCreatedTerminalPrompt({
  client,
  terminal,
  text,
  enter,
  deviceToken,
  successToast,
  errorToast,
  onDelivered,
  shouldReport = () => true,
  onSuccess,
  onError,
  showToast
}: CreatedTerminalPromptDeliveryOptions): void {
  if (!text?.trim()) {
    if (successToast && shouldReport()) {
      onSuccess()
      showToast(successToast)
    }
    return
  }
  void client
    .sendRequest(
      'terminal.send',
      buildTerminalSendParams({ terminal, text, enter: enter !== false, deviceToken })
    )
    .then((response) => {
      if (!response.ok) {
        throw new Error((response as RpcFailure).error.message || 'Failed to send notes')
      }
      const result = (response as RpcSuccess).result as { send?: { accepted?: boolean } }
      if (result.send?.accepted === false) {
        throw new Error('Terminal input is locked by another client.')
      }
      onDelivered?.()
      if (shouldReport()) {
        onSuccess()
        showToast(successToast ?? 'Notes sent')
      }
    })
    .catch((error) => {
      if (!shouldReport()) {
        return
      }
      onError()
      showToast(
        errorToast ?? (error instanceof Error ? error.message : "Couldn't send notes"),
        1800
      )
    })
}
