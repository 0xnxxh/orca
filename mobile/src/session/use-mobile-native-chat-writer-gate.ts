import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import { waitForMobileNativeChatStopLease } from './mobile-native-chat-stop-lease'

export type MobileNativeChatWriterGate = {
  beforeWrite: () => Promise<boolean>
  runWrite: <Result>(write: () => Promise<Result>, staleResult: Result) => Promise<Result>
}

export function useMobileNativeChatWriterGate(args: {
  client: RpcClient | null
  enabled: boolean
  handleRef: MutableRefObject<string | null>
  streamIdentity: string
}): MobileNativeChatWriterGate {
  const { client, enabled, handleRef, streamIdentity } = args
  const activeRouteRef = useRef({ client, enabled, streamIdentity })
  const routeVersionRef = useRef(0)

  useEffect(() => {
    activeRouteRef.current = { client, enabled, streamIdentity }
    return () => {
      routeVersionRef.current += 1
    }
  }, [client, enabled, streamIdentity])

  const beforeWrite = useCallback(async (): Promise<boolean> => {
    const terminal = handleRef.current
    if (!client || !enabled || !terminal) {
      return false
    }
    const routeVersion = routeVersionRef.current
    await waitForMobileNativeChatStopLease(terminal)
    const activeRoute = activeRouteRef.current
    return (
      routeVersionRef.current === routeVersion &&
      activeRoute.client === client &&
      activeRoute.enabled &&
      activeRoute.streamIdentity === streamIdentity &&
      handleRef.current === terminal
    )
  }, [client, enabled, handleRef, streamIdentity])

  const runWrite = useCallback(
    async <Result>(write: () => Promise<Result>, staleResult: Result): Promise<Result> => {
      if (!client || !enabled || !handleRef.current) {
        return write()
      }
      return (await beforeWrite()) ? write() : staleResult
    },
    [beforeWrite, client, enabled, handleRef]
  )

  return { beforeWrite, runWrite }
}
