import { useEffect, useState } from 'react'
import {
  MOBILE_WEB_BRIDGE_PROTOCOL_VERSION,
  type MobileWebBridgeShellMessage,
  type MobileWebResumeRoute
} from '../../../src/shared/mobile-web/bridge-contract'
import type { ConnectionState, HostProfile } from '../transport/types'
import { mobileWebBridgeErrorCode } from './mobile-web-broker-error'
import type { MobileWebCapabilityBroker } from './mobile-web-capability-broker'
import {
  MOBILE_WEB_NAVIGATION_INTENTS,
  type MobileWebNavigationIntent
} from './mobile-web-navigation-intent-buffer'

type ShellContext = {
  sessionId: string
  buildId: string
}

export function useMobileWebNavigationIntentHandoff(options: {
  hosts: readonly HostProfile[]
  hostsLoading: boolean
  selectedHostId: string | undefined
  connectionState: ConnectionState
  shellContext: ShellContext | null
  pageReadySessionId: string | undefined
  brokerSessionId: string | undefined
  getBroker: () => MobileWebCapabilityBroker | null
  selectHost: (hostId: string | undefined) => void
  refreshHosts: () => Promise<void>
  postMessage: (message: MobileWebBridgeShellMessage) => Promise<void>
  rememberRoute: (route: MobileWebResumeRoute) => void
  onNavigationResolved?: (intent: MobileWebNavigationIntent, route: MobileWebResumeRoute) => void
  showWarning: (warning: string) => void
}): void {
  const [intent, setIntent] = useState<MobileWebNavigationIntent | null>(null)

  useEffect(
    () =>
      MOBILE_WEB_NAVIGATION_INTENTS.subscribe((next) => {
        setIntent(next)
        options.selectHost(next.hostId)
        void options.refreshHosts()
      }),
    [options.refreshHosts, options.selectHost]
  )

  useEffect(() => {
    if (
      !intent ||
      options.hostsLoading ||
      options.hosts.some((host) => host.id === intent.hostId)
    ) {
      return
    }
    MOBILE_WEB_NAVIGATION_INTENTS.consume(intent.sequence)
    setIntent(null)
    options.selectHost(undefined)
  }, [intent, options.hosts, options.hostsLoading, options.selectHost])

  useEffect(() => {
    const context = options.shellContext
    if (
      !intent ||
      !context ||
      options.selectedHostId !== intent.hostId ||
      options.connectionState !== 'connected' ||
      options.pageReadySessionId !== context.sessionId ||
      options.brokerSessionId !== context.sessionId
    ) {
      return
    }
    const broker = options.getBroker()
    if (!broker) {
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const route =
          intent.target.kind === 'session'
            ? await broker.resolveNavigationRoute(intent.target.hostWorkspaceId)
            : ({ kind: 'workspaceList' } as const)
        if (
          cancelled ||
          !MOBILE_WEB_NAVIGATION_INTENTS.isCurrent(intent.sequence) ||
          options.getBroker() !== broker
        ) {
          return
        }
        options.rememberRoute(route)
        options.onNavigationResolved?.(intent, route)
        await options.postMessage({
          version: MOBILE_WEB_BRIDGE_PROTOCOL_VERSION,
          type: 'navigation',
          shellSessionId: context.sessionId,
          buildId: context.buildId,
          sequence: intent.sequence,
          route
        })
        if (!cancelled && MOBILE_WEB_NAVIGATION_INTENTS.consume(intent.sequence)) {
          setIntent(null)
        }
      } catch (error) {
        if (!cancelled && MOBILE_WEB_NAVIGATION_INTENTS.consume(intent.sequence)) {
          setIntent(null)
          options.showWarning(
            `${intent.source === 'coldResume' ? 'Previous workspace' : 'Notification destination'} could not be verified (${mobileWebBridgeErrorCode(error)}).`
          )
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [
    intent,
    options.brokerSessionId,
    options.connectionState,
    options.getBroker,
    options.onNavigationResolved,
    options.pageReadySessionId,
    options.postMessage,
    options.rememberRoute,
    options.selectedHostId,
    options.shellContext,
    options.showWarning
  ])
}
