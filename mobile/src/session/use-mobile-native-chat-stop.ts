import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import {
  openMobileNativeChatSendBudget,
  sendMobileNativeChatMessageWithOutcome,
  type MobileNativeChatSendOutcome
} from './mobile-native-chat-send'

const ESCAPE = String.fromCharCode(27)
const CODEX_STOP_BACKGROUND_TERMINALS = '/stop'
const STOP_STEP_DELAY_MS = 80

export function useMobileNativeChatStop(args: {
  client: RpcClient | null
  enabled: boolean
  handleRef: MutableRefObject<string | null>
  deviceTokenRef: MutableRefObject<string | null>
  agentRef: MutableRefObject<string | null>
  streamIdentity: string
  cancelPending: () => void
  onSendError: (message: string) => void
}): () => void {
  const {
    client,
    enabled,
    handleRef,
    deviceTokenRef,
    agentRef,
    streamIdentity,
    cancelPending,
    onSendError
  } = args
  const generationRef = useRef(0)
  const delayRef = useRef<{
    timer: ReturnType<typeof setTimeout>
    resolve: (completed: boolean) => void
  } | null>(null)
  const activeRouteRef = useRef({ client, enabled, streamIdentity })
  activeRouteRef.current = { client, enabled, streamIdentity }
  const cancelDelay = useCallback(() => {
    const delay = delayRef.current
    if (!delay) {
      return
    }
    clearTimeout(delay.timer)
    delayRef.current = null
    delay.resolve(false)
  }, [])
  useEffect(
    () => () => {
      generationRef.current += 1
      cancelDelay()
    },
    [cancelDelay, client, enabled, streamIdentity]
  )
  return useCallback(() => {
    const handle = handleRef.current
    if (!client || !handle || !enabled) {
      onSendError('Stop not sent (terminal not ready)')
      return
    }
    cancelPending()
    generationRef.current += 1
    const generation = generationRef.current
    cancelDelay()
    const agent = agentRef.current
    const stopStreamIdentity = streamIdentity
    const deadline = openMobileNativeChatSendBudget()
    const isCurrentRoute = (): boolean => {
      const activeRoute = activeRouteRef.current
      return (
        generationRef.current === generation &&
        activeRoute.enabled &&
        activeRoute.client === client &&
        activeRoute.streamIdentity === stopStreamIdentity &&
        handleRef.current === handle &&
        agentRef.current === agent
      )
    }
    const waitForNextStep = (): Promise<boolean> =>
      new Promise((resolve) => {
        if (!isCurrentRoute()) {
          resolve(false)
          return
        }
        const delay = {
          timer: setTimeout(() => {
            if (delayRef.current === delay) {
              delayRef.current = null
            }
            resolve(isCurrentRoute())
          }, STOP_STEP_DELAY_MS),
          resolve
        }
        delayRef.current = delay
      })
    const send = async (
      text: string,
      enter: boolean
    ): Promise<MobileNativeChatSendOutcome | null> => {
      if (!isCurrentRoute()) {
        return null
      }
      return sendMobileNativeChatMessageWithOutcome({
        client,
        terminal: handle,
        text,
        enter,
        deadline,
        ...(deviceTokenRef.current
          ? { mobileClient: { id: deviceTokenRef.current, type: 'mobile' as const } }
          : {})
      })
    }
    void (async () => {
      const firstEscape = send(ESCAPE, false)
      if (!(await waitForNextStep())) {
        return
      }
      const outcomes = await Promise.all([firstEscape, send(ESCAPE, false)])
      if (!isCurrentRoute() || outcomes.includes(null)) {
        return
      }
      const escapes = outcomes as MobileNativeChatSendOutcome[]
      if (!escapes.includes('accepted')) {
        // An ambiguous Escape may have landed; a definite failure would invite
        // a retry into changed prompt state.
        onSendError(
          escapes.includes('unknown')
            ? 'Stop unconfirmed — check chat before retrying'
            : 'Stop not sent'
        )
        return
      }
      if (agent !== 'codex' || !(await waitForNextStep())) {
        return
      }
      // Codex owns spawned background terminals beyond the interrupted turn;
      // its /stop command closes them without exiting the reusable session.
      const cleanup = await send(CODEX_STOP_BACKGROUND_TERMINALS, true)
      if (cleanup === 'rejected' && isCurrentRoute()) {
        onSendError('Stop incomplete — send /stop to close background tools')
      } else if (cleanup === 'unknown' && isCurrentRoute()) {
        onSendError('Stop unconfirmed — check chat before retrying')
      }
    })()
  }, [
    agentRef,
    cancelPending,
    cancelDelay,
    client,
    deviceTokenRef,
    enabled,
    handleRef,
    onSendError,
    streamIdentity
  ])
}
