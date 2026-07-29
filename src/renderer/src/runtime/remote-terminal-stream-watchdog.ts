export const REMOTE_TERMINAL_COMMAND_RESPONSE_TIMEOUT_MS = 10_000
export const REMOTE_TERMINAL_DELIVERY_STALL_TIMEOUT_MS = 30_000

export type RemoteTerminalStreamStall = {
  inactiveForMs: number
  outstandingDeliveryBytes: number
  reason: 'command-response-timeout' | 'delivery-credit-timeout'
}

export type RemoteTerminalStreamWatchdog = {
  beginOutputDelivery: (bytes: number) => () => void
  recordCommandInput: (text: string) => void
  recordInbound: () => void
  dispose: () => void
}

export function createRemoteTerminalStreamWatchdog(
  onStall: (stall: RemoteTerminalStreamStall) => void
): RemoteTerminalStreamWatchdog {
  let responseTimer: ReturnType<typeof setTimeout> | null = null
  let deliveryTimer: ReturnType<typeof setTimeout> | null = null
  let outstandingDeliveryBytes = 0
  let lastInboundAtMs = Date.now()
  let disposed = false

  const clearResponseTimer = (): void => {
    if (responseTimer) {
      clearTimeout(responseTimer)
      responseTimer = null
    }
  }
  const clearDeliveryTimer = (): void => {
    if (deliveryTimer) {
      clearTimeout(deliveryTimer)
      deliveryTimer = null
    }
  }
  const trip = (reason: RemoteTerminalStreamStall['reason']): void => {
    if (disposed) {
      return
    }
    disposed = true
    clearResponseTimer()
    clearDeliveryTimer()
    onStall({
      inactiveForMs: Math.max(0, Date.now() - lastInboundAtMs),
      outstandingDeliveryBytes,
      reason
    })
  }
  const armDeliveryTimer = (): void => {
    clearDeliveryTimer()
    if (outstandingDeliveryBytes <= 0 || disposed) {
      return
    }
    deliveryTimer = setTimeout(
      () => trip('delivery-credit-timeout'),
      REMOTE_TERMINAL_DELIVERY_STALL_TIMEOUT_MS
    )
  }

  return {
    beginOutputDelivery(bytes) {
      outstandingDeliveryBytes += bytes
      if (!deliveryTimer) {
        armDeliveryTimer()
      }
      let settled = false
      return () => {
        if (settled || disposed) {
          return
        }
        settled = true
        outstandingDeliveryBytes = Math.max(0, outstandingDeliveryBytes - bytes)
        armDeliveryTimer()
      }
    },
    recordCommandInput(text) {
      if (disposed || responseTimer || !/[\r\n]/u.test(text)) {
        return
      }
      responseTimer = setTimeout(
        () => trip('command-response-timeout'),
        REMOTE_TERMINAL_COMMAND_RESPONSE_TIMEOUT_MS
      )
    },
    recordInbound() {
      lastInboundAtMs = Date.now()
      clearResponseTimer()
    },
    dispose() {
      disposed = true
      clearResponseTimer()
      clearDeliveryTimer()
      outstandingDeliveryBytes = 0
    }
  }
}
