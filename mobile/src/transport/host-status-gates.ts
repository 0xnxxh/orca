import { useEffect, useRef, useState } from 'react'
import type { RpcClient } from './rpc-client'
import type { ConnectionState, RpcSuccess } from './types'
import { evaluateCompat, type CompatVerdict } from './protocol-compat'
import type { DesktopStatus } from '../worktree/host-worktree-rpc-types'

export type HostStatusGates = {
  hostCapabilities: string[]
  floatingWorkspaceEnabled: boolean
  compatVerdict: CompatVerdict
}

// Reads status.get on connect for capabilities, protocol-compat verdict, and the
// floating-workspace flag. Compat constants are wide-open today so this never blocks yet.
export function useHostStatusGates(args: {
  hostId: string | undefined
  client: RpcClient | null
  connState: ConnectionState
}): HostStatusGates {
  const { hostId, client, connState } = args
  const [hostCapabilities, setHostCapabilities] = useState<string[]>([])
  const [floatingWorkspaceEnabled, setFloatingWorkspaceEnabled] = useState(false)
  const [compatVerdict, setCompatVerdict] = useState<CompatVerdict>({ kind: 'ok' })
  const clientRef = useRef<RpcClient | null>(null)

  useEffect(() => {
    clientRef.current = client
  }, [client])

  // Why: Expo can render the next host once with the prior client, so hide every host-scoped gate until its client answers.
  useEffect(() => {
    setHostCapabilities([])
    setFloatingWorkspaceEnabled(false)
    setCompatVerdict({ kind: 'ok' })
  }, [hostId])

  useEffect(() => {
    if (connState !== 'connected' || !client) {
      // Why: drop capabilities while disconnected/switching so a capability-gated action can't linger for a new host.
      setHostCapabilities([])
      setFloatingWorkspaceEnabled(false)
      return
    }
    let cancelled = false
    const requestClient = client
    void (async () => {
      try {
        const response = await requestClient.sendRequest('status.get')
        if (cancelled || clientRef.current !== requestClient) {
          return
        }
        if (!response.ok) {
          setHostCapabilities([])
          setFloatingWorkspaceEnabled(false)
          return
        }
        const status = (response as RpcSuccess).result as DesktopStatus & {
          capabilities?: string[]
        }
        setHostCapabilities(status.capabilities ?? [])
        setFloatingWorkspaceEnabled(status.floatingWorkspaceEnabled === true)
        const verdict = evaluateCompat({
          desktopProtocolVersion: status.protocolVersion,
          desktopMinCompatibleMobileVersion: status.minCompatibleMobileVersion
        })
        setCompatVerdict(verdict)
        if (verdict.kind === 'blocked') {
          // Why: support breadcrumb to confirm a block fired vs a render bug; no PII, just version ints.
          console.warn('[protocol-compat] blocked', {
            reason: verdict.reason,
            desktopVersion: verdict.desktopVersion,
            requiredMobileVersion: verdict.requiredMobileVersion,
            requiredDesktopVersion: verdict.requiredDesktopVersion
          })
        }
      } catch {
        // Why: sendRequest can throw on transport tear-down; treat as transient, keep the prior verdict.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [connState, client])

  return { hostCapabilities, floatingWorkspaceEnabled, compatVerdict }
}
