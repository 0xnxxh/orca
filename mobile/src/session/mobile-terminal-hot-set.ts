export const MOBILE_TERMINAL_HOT_SET_RECENT_LIMIT = 2
export const MOBILE_TERMINAL_HOT_SET_GRACE_MS = 20_000

export type MobileTerminalHotSetState = Readonly<{
  scopeKey: string
  activeHandle: string | null
  recentHandles: readonly string[]
  mountedHandles: ReadonlySet<string>
  graceDeadlines: ReadonlyMap<string, number>
  failOpen: boolean
}>

export type MobileTerminalHotSetTransition = Readonly<{
  state: MobileTerminalHotSetState
  evictedHandles: readonly string[]
  nextDeadline: number | null
}>

export function createMobileTerminalHotSetState(scopeKey: string): MobileTerminalHotSetState {
  return {
    scopeKey,
    activeHandle: null,
    recentHandles: [],
    mountedHandles: new Set(),
    graceDeadlines: new Map(),
    failOpen: false
  }
}

export function reconcileMobileTerminalHotSet(
  previous: MobileTerminalHotSetState,
  input: {
    scopeKey: string
    enabled: boolean
    handles: readonly string[]
    activeHandle: string | null
    now: number
    graceMs?: number
  }
): MobileTerminalHotSetTransition {
  const liveHandles = new Set(input.handles)
  const scopeChanged = previous.scopeKey !== input.scopeKey
  const prior = scopeChanged ? createMobileTerminalHotSetState(input.scopeKey) : previous
  const failOpen = scopeChanged ? false : prior.failOpen

  if (!input.enabled || failOpen) {
    const mountedHandles = new Set(input.handles)
    return transition(
      {
        scopeKey: input.scopeKey,
        activeHandle: input.activeHandle,
        recentHandles: reconcileRecentHandles(prior, input.activeHandle, liveHandles),
        mountedHandles,
        graceDeadlines: new Map(),
        failOpen
      },
      removedMountedHandles(prior.mountedHandles, mountedHandles)
    )
  }

  const recentHandles = reconcileRecentHandles(prior, input.activeHandle, liveHandles)
  const retainedHandles = new Set(
    [input.activeHandle, ...recentHandles.slice(0, MOBILE_TERMINAL_HOT_SET_RECENT_LIMIT)].filter(
      (handle): handle is string => handle != null && liveHandles.has(handle)
    )
  )
  const mountedHandles = new Set<string>(retainedHandles)
  const graceDeadlines = new Map<string, number>()
  const newestGraceHandle = recentHandles.find(
    (handle) => prior.mountedHandles.has(handle) && !retainedHandles.has(handle)
  )
  if (newestGraceHandle) {
    const deadline =
      prior.graceDeadlines.get(newestGraceHandle) ??
      input.now + (input.graceMs ?? MOBILE_TERMINAL_HOT_SET_GRACE_MS)
    if (deadline > input.now) {
      mountedHandles.add(newestGraceHandle)
      graceDeadlines.set(newestGraceHandle, deadline)
    }
  }

  return transition(
    {
      scopeKey: input.scopeKey,
      activeHandle: input.activeHandle,
      recentHandles,
      mountedHandles,
      graceDeadlines,
      failOpen: false
    },
    removedMountedHandles(prior.mountedHandles, mountedHandles)
  )
}

export function failOpenMobileTerminalHotSet(
  previous: MobileTerminalHotSetState,
  handles: readonly string[]
): MobileTerminalHotSetTransition {
  const mountedHandles = new Set(handles)
  return transition(
    {
      ...previous,
      mountedHandles,
      graceDeadlines: new Map(),
      failOpen: true
    },
    removedMountedHandles(previous.mountedHandles, mountedHandles)
  )
}

function reconcileRecentHandles(
  previous: MobileTerminalHotSetState,
  activeHandle: string | null,
  liveHandles: ReadonlySet<string>
): string[] {
  const recent = previous.recentHandles.filter(
    (handle) => handle !== activeHandle && liveHandles.has(handle)
  )
  const priorActive = previous.activeHandle
  if (priorActive && priorActive !== activeHandle && liveHandles.has(priorActive)) {
    recent.unshift(priorActive)
  }
  return [...new Set(recent)].slice(0, MOBILE_TERMINAL_HOT_SET_RECENT_LIMIT + 1)
}

function removedMountedHandles(previous: ReadonlySet<string>, next: ReadonlySet<string>): string[] {
  return [...previous].filter((handle) => !next.has(handle))
}

function transition(
  state: MobileTerminalHotSetState,
  evictedHandles: readonly string[]
): MobileTerminalHotSetTransition {
  const nextDeadline =
    state.graceDeadlines.size === 0 ? null : Math.min(...state.graceDeadlines.values())
  return { state, evictedHandles, nextDeadline }
}
