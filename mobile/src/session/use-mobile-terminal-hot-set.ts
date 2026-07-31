import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  MOBILE_TERMINAL_HOT_SET_GRACE_MS,
  createMobileTerminalHotSetState,
  failOpenMobileTerminalHotSet,
  reconcileMobileTerminalHotSet,
  type MobileTerminalHotSetTransition
} from './mobile-terminal-hot-set'

export const MOBILE_TERMINAL_HOT_SET_ENABLED =
  process.env.EXPO_PUBLIC_ORCA_MOBILE_TERMINAL_HOT_SET === '1'
export const MOBILE_TERMINAL_COLD_REVEAL_TIMEOUT_MS = 15_000

export function isAdmissibleMobileTerminalColdScrollback(
  data: Readonly<Record<string, unknown>>
): boolean {
  return (
    data.type === 'scrollback' &&
    typeof data.serialized === 'string' &&
    Number.isSafeInteger(data.cols) &&
    (data.cols as number) > 0 &&
    Number.isSafeInteger(data.rows) &&
    (data.rows as number) > 0 &&
    (data.source === 'headless' || data.source === 'renderer') &&
    (data.truncated === undefined || data.truncated === false) &&
    (data.truncatedByByteBudget === undefined || data.truncatedByByteBudget === false)
  )
}

type ColdReveal = Readonly<{ handle: string; revision: number }>

export function useMobileTerminalHotSet(args: {
  scopeKey: string
  featureEnabled: boolean
  connectionAdmissible?: boolean
  inadmissibleReason?: string | null
  handles: readonly string[]
  activeHandle: string | null
  onEvict: (handle: string) => void
  graceMs?: number
}): {
  mountedHandles: ReadonlySet<string>
  acceptsStreamEvent: (handle: string) => boolean
  coldRevealRevision: (handle: string) => number | null
  completeColdReveal: (handle: string, revision: number) => boolean
  failOpen: (reason: string) => void
  failOpenReason: string | null
} {
  const [, setRevision] = useState(0)
  const ownerRef = useRef(createMobileTerminalHotSetState(args.scopeKey))
  const mountedHandlesRef = useRef<ReadonlySet<string>>(new Set())
  const liveHandlesRef = useRef<ReadonlySet<string>>(new Set())
  const handlesRef = useRef(args.handles)
  const featureEnabledRef = useRef(args.featureEnabled)
  const onEvictRef = useRef(args.onEvict)
  const evictionsRef = useRef<string[]>([])
  const coldRevealRef = useRef<ColdReveal | null>(null)
  const coldRevealRevisionRef = useRef(0)
  const failOpenReasonRef = useRef<string | null>(null)
  const graceMs = args.graceMs ?? MOBILE_TERMINAL_HOT_SET_GRACE_MS
  const connectionAdmissible = args.connectionAdmissible ?? true
  const pendingFailOpenReason =
    args.featureEnabled && !connectionAdmissible
      ? (args.inadmissibleReason ?? 'connection-uncertain')
      : null
  const transition = reconcileWithGrace(
    ownerRef.current,
    args.scopeKey,
    args.featureEnabled && connectionAdmissible,
    args.handles,
    args.activeHandle,
    Date.now(),
    graceMs
  )
  const coldReveal = deriveColdReveal(
    ownerRef.current,
    coldRevealRef.current,
    coldRevealRevisionRef.current,
    transition,
    args
  )

  useLayoutEffect(() => {
    let committedTransition = transition
    let committedColdReveal = coldReveal
    const scopeChanged = transition.state.scopeKey !== ownerRef.current.scopeKey
    if (scopeChanged) {
      failOpenReasonRef.current = null
    }
    if (pendingFailOpenReason) {
      failOpenReasonRef.current ??= pendingFailOpenReason
      committedTransition = failOpenMobileTerminalHotSet(transition.state, args.handles)
      committedColdReveal = null
    }

    ownerRef.current = committedTransition.state
    mountedHandlesRef.current = committedTransition.state.mountedHandles
    liveHandlesRef.current = new Set(args.handles)
    handlesRef.current = args.handles
    featureEnabledRef.current = args.featureEnabled
    onEvictRef.current = args.onEvict
    coldRevealRef.current = committedColdReveal
    if (committedColdReveal) {
      coldRevealRevisionRef.current = Math.max(
        coldRevealRevisionRef.current,
        committedColdReveal.revision
      )
    }
    for (const handle of committedTransition.evictedHandles) {
      if (!evictionsRef.current.includes(handle)) {
        evictionsRef.current.push(handle)
      }
    }
  }, [args, coldReveal, pendingFailOpenReason, transition])

  useEffect(() => {
    const evictions = evictionsRef.current.splice(0)
    for (const handle of evictions) {
      if (!mountedHandlesRef.current.has(handle)) {
        onEvictRef.current(handle)
      }
    }
  })

  useEffect(() => {
    const deadline = transition.nextDeadline
    if (deadline == null) {
      return
    }
    const timer = setTimeout(
      () => {
        const current = ownerRef.current
        const next = reconcileWithGrace(
          current,
          current.scopeKey,
          featureEnabledRef.current,
          handlesRef.current,
          current.activeHandle,
          Date.now(),
          graceMs
        )
        ownerRef.current = next.state
        mountedHandlesRef.current = next.state.mountedHandles
        evictionsRef.current.push(...next.evictedHandles)
        setRevision((revision) => revision + 1)
      },
      Math.max(0, deadline - Date.now())
    )
    return () => clearTimeout(timer)
  }, [graceMs, transition.nextDeadline])

  const coldRevealTimerRevision = coldReveal?.revision ?? null
  useEffect(() => {
    if (
      coldRevealTimerRevision == null ||
      coldRevealRef.current?.revision !== coldRevealTimerRevision
    ) {
      return
    }
    const timer = setTimeout(() => {
      const current = coldRevealRef.current
      if (current?.revision !== coldRevealTimerRevision) {
        return
      }
      failOpenReasonRef.current ??= 'cold-reveal-timeout'
      const next = failOpenMobileTerminalHotSet(ownerRef.current, handlesRef.current)
      ownerRef.current = next.state
      mountedHandlesRef.current = next.state.mountedHandles
      coldRevealRef.current = null
      setRevision((revision) => revision + 1)
    }, MOBILE_TERMINAL_COLD_REVEAL_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [coldRevealTimerRevision])

  const acceptsStreamEvent = useCallback(
    (handle: string) => mountedHandlesRef.current.has(handle) && liveHandlesRef.current.has(handle),
    []
  )
  const coldRevealRevision = useCallback(
    (handle: string) =>
      coldRevealRef.current?.handle === handle ? coldRevealRef.current.revision : null,
    []
  )
  const completeColdReveal = useCallback((handle: string, revision: number) => {
    if (
      coldRevealRef.current?.handle !== handle ||
      coldRevealRef.current.revision !== revision ||
      ownerRef.current.failOpen
    ) {
      return false
    }
    coldRevealRef.current = null
    setRevision((current) => current + 1)
    return true
  }, [])
  const failOpen = useCallback((reason: string) => {
    if (!featureEnabledRef.current || ownerRef.current.failOpen) {
      return
    }
    failOpenReasonRef.current = reason
    const next = failOpenMobileTerminalHotSet(ownerRef.current, handlesRef.current)
    ownerRef.current = next.state
    mountedHandlesRef.current = next.state.mountedHandles
    coldRevealRef.current = null
    setRevision((revision) => revision + 1)
  }, [])

  return {
    mountedHandles: transition.state.mountedHandles,
    acceptsStreamEvent,
    coldRevealRevision,
    completeColdReveal,
    failOpen,
    failOpenReason: failOpenReasonRef.current ?? pendingFailOpenReason
  }
}

function deriveColdReveal(
  previous: ReturnType<typeof createMobileTerminalHotSetState>,
  current: ColdReveal | null,
  latestRevision: number,
  transition: MobileTerminalHotSetTransition,
  args: {
    scopeKey: string
    featureEnabled: boolean
    connectionAdmissible?: boolean
    activeHandle: string | null
  }
): ColdReveal | null {
  if (
    !args.featureEnabled ||
    args.connectionAdmissible === false ||
    transition.state.failOpen ||
    previous.scopeKey !== args.scopeKey
  ) {
    return null
  }
  if (current?.handle === args.activeHandle) {
    return current
  }
  if (
    args.activeHandle == null ||
    previous.activeHandle === args.activeHandle ||
    previous.mountedHandles.has(args.activeHandle)
  ) {
    return null
  }
  return { handle: args.activeHandle, revision: latestRevision + 1 }
}

function reconcileWithGrace(
  previous: ReturnType<typeof createMobileTerminalHotSetState>,
  scopeKey: string,
  enabled: boolean,
  handles: readonly string[],
  activeHandle: string | null,
  now: number,
  graceMs: number
): MobileTerminalHotSetTransition {
  return reconcileMobileTerminalHotSet(previous, {
    scopeKey,
    enabled,
    handles,
    activeHandle,
    now,
    graceMs
  })
}
