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

// Why: read desktop's protocol version from status.get on every connect and
// re-evaluate compatibility. If the desktop declares this mobile build too old
// (or vice versa via the local minimum), the host detail screen swaps to a
// hard-block screen instead of the worktree list. Today's compat constants are
// wide-open so this never blocks; the wire format is in place to flip a switch
// in a future release.
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

  // Why: switching hosts must clear the previous host's verdict so a stale
  // block screen can't linger for the next host.
  useEffect(() => {
    setCompatVerdict({ kind: 'ok' })
  }, [hostId])

  useEffect(() => {
    if (connState !== 'connected' || !client) {
      // Why: drop the prior host's capabilities while disconnected/switching so
      // a capability-gated action (e.g. Agent Session History) can't linger for
      // a host that doesn't support it.
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
          // Why: deterministic breadcrumb so support can confirm a block
          // actually fired (vs a render bug). No PII — just version ints.
          console.warn('[protocol-compat] blocked', {
            reason: verdict.reason,
            desktopVersion: verdict.desktopVersion,
            requiredMobileVersion: verdict.requiredMobileVersion,
            requiredDesktopVersion: verdict.requiredDesktopVersion
          })
        }
      } catch {
        // Why: rare path — sendRequest can throw on transport tear-down.
        // Treat as transient; verdict stays at previous value.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [connState, client])

  return { hostCapabilities, floatingWorkspaceEnabled, compatVerdict }
}
