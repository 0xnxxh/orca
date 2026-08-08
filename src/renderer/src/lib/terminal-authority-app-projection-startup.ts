import { isWebClientLocation } from './web-client-location'
import { TerminalAuthorityAppProjectionController } from './terminal-authority-app-projection-controller'
import { onTerminalAuthorityAppProjectionPolicyAvailable } from './terminal-authority-app-projection-policy'

let controller: TerminalAuthorityAppProjectionController | null = null
let previousSubscriptionIncarnationId: string | null = null
let stopPolicyAvailability: (() => void) | null = null
let pageHideInstalled = false

export function startTerminalAuthorityAppProjectionController(): void {
  if (controller || isWebClientLocation()) {
    return
  }
  const subscriptionIncarnationId = crypto.randomUUID()
  const next = new TerminalAuthorityAppProjectionController({
    transport: {
      onDelta: (listener) => window.api.pty.onAuthorityProjection(listener),
      subscribe: (request) => window.api.pty.subscribeAuthorityProjection(request),
      clearBell: (request) => window.api.pty.clearAuthorityProjectionBell(request)
    },
    subscriptionIncarnationId,
    expectedSubscriptionIncarnationId: previousSubscriptionIncarnationId,
    onError: (error) => console.error('[terminal-authority] projection observation failed', error)
  })
  controller = next
  previousSubscriptionIncarnationId = subscriptionIncarnationId
  stopPolicyAvailability = onTerminalAuthorityAppProjectionPolicyAvailable(() =>
    next.retryFailedRows()
  )
  void next.start().catch(() => {
    if (controller === next) {
      stopTerminalAuthorityAppProjectionController()
    }
  })
  if (!pageHideInstalled) {
    pageHideInstalled = true
    window.addEventListener('pagehide', stopTerminalAuthorityAppProjectionController, {
      once: true
    })
  }
}

export function stopTerminalAuthorityAppProjectionController(): void {
  controller?.dispose()
  controller = null
  stopPolicyAvailability?.()
  stopPolicyAvailability = null
}
