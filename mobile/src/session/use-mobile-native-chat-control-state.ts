import { useEffect, useState } from 'react'
import { canStopNativeChatAgent } from '../../../src/shared/native-chat-action-availability'

const CONTROL_STATE_SETTLE_MS = 600

export type MobileNativeChatInputLockReason = 'disconnected' | 'waiting'

function useDelayedActivation(active: boolean): boolean {
  const [delayedActive, setDelayedActive] = useState(false)
  useEffect(() => {
    if (!active) {
      setDelayedActive(false)
      return
    }
    const timer = setTimeout(() => setDelayedActive(true), CONTROL_STATE_SETTLE_MS)
    return () => clearTimeout(timer)
  }, [active])
  return active && delayedActive
}

export function useMobileNativeChatControlState(args: {
  inputLockReason: MobileNativeChatInputLockReason | null
  agentStatusLive: boolean
  stopTargetWritable: boolean
  stopCommandAvailable: boolean
}): {
  lockReason: MobileNativeChatInputLockReason | null
  statusStale: boolean
  canStopAgent: boolean
} {
  const rawLockHeld = args.inputLockReason !== null
  const [lockHeld, setLockHeld] = useState(false)
  useEffect(() => {
    if (rawLockHeld === lockHeld) {
      return
    }
    const timer = setTimeout(() => setLockHeld(rawLockHeld), CONTROL_STATE_SETTLE_MS)
    return () => clearTimeout(timer)
  }, [lockHeld, rawLockHeld])
  const statusStale = useDelayedActivation(!args.agentStatusLive)

  return {
    lockReason: lockHeld ? (args.inputLockReason ?? 'waiting') : null,
    statusStale,
    canStopAgent: canStopNativeChatAgent({
      targetWritable: args.stopTargetWritable,
      stopCommandAvailable: args.stopCommandAvailable
    })
  }
}
