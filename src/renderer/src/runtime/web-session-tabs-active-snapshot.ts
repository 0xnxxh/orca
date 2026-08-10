import type { RuntimeMobileSessionTabsResult } from '../../../shared/runtime-types'
import { useAppStore } from '../store'
import {
  acceptReplayedWebSessionTabsSnapshot,
  applyWebSessionTabsSnapshot,
  applyWebSessionTabsSnapshots,
  applyWebSessionTabsStorePatch,
  shouldApplyWebSessionTabsSnapshot,
  shouldBootstrapInitialWebRuntimeTerminal,
  shouldRespawnWebRuntimeTerminalAfterWake
} from './web-session-tabs-sync'
import { createWebRuntimeSessionTerminal } from './web-runtime-session'
import {
  beginWebRuntimeWakeTerminalRespawn,
  endWebRuntimeWakeTerminalRespawn,
  shouldSkipWebRuntimeWakeTerminalRespawn
} from './web-runtime-wake-terminal-respawn'
import { recoverWebSessionTerminalOrphansBeforeApply } from './web-session-terminal-orphan-recovery'
import type { SessionTabsSnapshotEvent } from './web-session-tabs-events'

export type ActiveSessionTabsContext = {
  targetKey: string
  environmentId: string
  pairingRevision: number
  supportsAtomicGlobalSubscription: boolean
  worktreeId: string
  requestedInitialTerminal: boolean
  requestedRespawnAfterWake: boolean
}

export type ActiveSessionTabsContextRef = {
  current: ActiveSessionTabsContext | null
}

type SnapshotInput = {
  snapshot: RuntimeMobileSessionTabsResult
  type: SessionTabsSnapshotEvent['type']
}

type ProcessSnapshotsArgs = {
  environmentId: string
  targetKey: string
  snapshots: readonly SnapshotInput[]
  replayed: boolean
  acceptCurrent: boolean
  activeContextRef: ActiveSessionTabsContextRef
  isCurrent: () => boolean
}

type ActiveLifecycleDecision = {
  context: ActiveSessionTabsContext
  bootstrap: boolean
  wake: boolean
}

function getActiveLifecycleDecision(
  context: ActiveSessionTabsContext,
  event: SessionTabsSnapshotEvent,
  fresh: boolean
): ActiveLifecycleDecision {
  const state = useAppStore.getState()
  const localWorktreeTabs = state.tabsByWorktree[context.worktreeId] ?? []
  const localTerminalCount = localWorktreeTabs.length
  const hasLiveLocalPty = localWorktreeTabs.some(
    (tab) => (state.ptyIdsByTabId[tab.id] ?? []).length > 0
  )
  return {
    context,
    bootstrap: shouldBootstrapInitialWebRuntimeTerminal({
      event,
      activeWorktreeId: context.worktreeId,
      requestedInitialTerminal: context.requestedInitialTerminal,
      snapshotIsFresh: fresh,
      localTerminalCount
    }),
    wake: shouldRespawnWebRuntimeTerminalAfterWake({
      event,
      activeWorktreeId: context.worktreeId,
      requestedRespawnAfterWake: context.requestedRespawnAfterWake,
      snapshotIsFresh: fresh,
      localTerminalCount,
      hasLiveLocalPty,
      skipWakeRespawn: shouldSkipWebRuntimeWakeTerminalRespawn(context.worktreeId)
    })
  }
}

async function runActiveLifecycle(
  decision: ActiveLifecycleDecision,
  activeContextRef: ActiveSessionTabsContextRef
): Promise<void> {
  const { context, bootstrap, wake } = decision
  if (
    (!bootstrap && !wake) ||
    activeContextRef.current !== context ||
    !beginWebRuntimeWakeTerminalRespawn(context.worktreeId)
  ) {
    return
  }
  if (bootstrap) {
    context.requestedInitialTerminal = true
  } else {
    context.requestedRespawnAfterWake = true
  }
  try {
    await createWebRuntimeSessionTerminal({
      worktreeId: context.worktreeId,
      environmentId: context.environmentId,
      activate: true,
      ...(wake ? { selectWorktree: false } : {})
    })
  } finally {
    endWebRuntimeWakeTerminalRespawn(context.worktreeId)
  }
}

export async function recoverAndApplyWebSessionTabsSnapshots(
  args: ProcessSnapshotsArgs
): Promise<ActiveSessionTabsContext | null> {
  const recovered = await Promise.all(
    args.snapshots.map(async ({ snapshot, type }) => {
      const result = await recoverWebSessionTerminalOrphansBeforeApply(
        useAppStore.getState(),
        snapshot,
        args.environmentId
      )
      return result ? ({ ...result, type } satisfies SessionTabsSnapshotEvent) : null
    })
  )
  if (!args.isCurrent()) {
    return null
  }

  const applicable = recovered.filter((event): event is SessionTabsSnapshotEvent => event !== null)
  if (args.replayed || args.acceptCurrent) {
    for (const event of applicable) {
      acceptReplayedWebSessionTabsSnapshot(args.environmentId, event.worktree)
    }
  }

  const freshSnapshots: RuntimeMobileSessionTabsResult[] = []
  let activeDecision: ActiveLifecycleDecision | null = null
  let servicedActiveContext: ActiveSessionTabsContext | null = null
  for (const event of applicable) {
    const context = args.activeContextRef.current
    const isActive = context?.targetKey === args.targetKey && context.worktreeId === event.worktree
    const fresh = shouldApplyWebSessionTabsSnapshot(event, args.environmentId)
    if (isActive && context) {
      servicedActiveContext = context
      activeDecision = getActiveLifecycleDecision(context, event, fresh)
    }
    if (fresh) {
      freshSnapshots.push(event)
    }
  }
  if (freshSnapshots.length === 1) {
    applyWebSessionTabsStorePatch((state) =>
      applyWebSessionTabsSnapshot(state, freshSnapshots[0], args.environmentId)
    )
  } else if (freshSnapshots.length > 1) {
    applyWebSessionTabsStorePatch((state) =>
      applyWebSessionTabsSnapshots(state, freshSnapshots, args.environmentId)
    )
  }
  if (activeDecision && args.isCurrent()) {
    void runActiveLifecycle(activeDecision, args.activeContextRef).catch((error) => {
      if (args.isCurrent()) {
        console.warn('[web-session-tabs-sync] active terminal recovery failed:', error)
      }
    })
  }
  return servicedActiveContext
}
