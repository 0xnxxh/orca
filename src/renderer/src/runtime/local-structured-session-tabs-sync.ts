import { useEffect } from 'react'
import { STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY } from '../../../shared/protocol-version'
import type { RuntimeMobileSessionTabsResult } from '../../../shared/runtime-types'
import { useAppStore } from '../store'
import { applyWebSessionTabsSnapshot, applyWebSessionTabsStorePatch } from './web-session-tabs-sync'

const LOCAL_STRUCTURED_SESSION_OWNER = 'local-structured-session'

type SessionTabsEvent =
  | (RuntimeMobileSessionTabsResult & { type: 'snapshot' | 'updated' })
  | { type: 'snapshots'; snapshots: RuntimeMobileSessionTabsResult[] }
  | { type: 'end' }

function structuredOnly(snapshot: RuntimeMobileSessionTabsResult): RuntimeMobileSessionTabsResult {
  const structuredIds = new Set(
    snapshot.tabs.filter((tab) => tab.type === 'agent-session').map((tab) => tab.id)
  )
  return {
    ...snapshot,
    tabs: snapshot.tabs.filter((tab) => structuredIds.has(tab.id)),
    tabGroups: snapshot.tabGroups?.map((group) => ({
      ...group,
      tabOrder: group.tabOrder.filter((id) => structuredIds.has(id)),
      activeTabId:
        group.activeTabId && structuredIds.has(group.activeTabId) ? group.activeTabId : null,
      recentTabIds: group.recentTabIds?.filter((id) => structuredIds.has(id))
    }))
  }
}

function applySnapshots(snapshots: readonly RuntimeMobileSessionTabsResult[]): void {
  applyWebSessionTabsStorePatch((state) => {
    let next = state
    for (const snapshot of snapshots) {
      const patch = applyWebSessionTabsSnapshot(
        next,
        structuredOnly(snapshot),
        LOCAL_STRUCTURED_SESSION_OWNER
      )
      next = patch === next ? next : ({ ...next, ...patch } as typeof state)
    }
    return next
  })
}

async function startLocalStructuredSessionTabsSync(args: {
  isDisposed: () => boolean
  setUnsubscribe: (unsubscribe: () => void) => void
}): Promise<void> {
  const status = await window.api.runtime.getStatus()
  if (args.isDisposed()) {
    return
  }
  const supported = status.capabilities?.includes(STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY)
  void window.api.runtime.call({ method: 'session.tabs.listAll', params: {} }).then((response) => {
    if (!args.isDisposed() && response.ok) {
      const result = response.result as { snapshots?: RuntimeMobileSessionTabsResult[] }
      applySnapshots(result.snapshots ?? [])
    }
  })
  if (!supported) {
    return
  }
  const handle = await window.api.runtime.subscribe(
    { method: 'session.tabs.subscribeAll', params: {} },
    (response) => {
      if (args.isDisposed() || !response.ok) {
        return
      }
      const event = response.result as SessionTabsEvent
      if (event.type === 'snapshots') {
        applySnapshots(event.snapshots)
      } else if (event.type === 'snapshot' || event.type === 'updated') {
        applySnapshots([event])
      }
    }
  )
  if (args.isDisposed()) {
    handle.unsubscribe()
  } else {
    args.setUnsubscribe(handle.unsubscribe)
  }
}

export function useLocalStructuredSessionTabsSync(): void {
  const ready = useAppStore((state) => state.workspaceSessionReady)
  useEffect(() => {
    if (!ready) {
      return
    }
    let disposed = false
    let unsubscribe = (): void => {}
    void startLocalStructuredSessionTabsSync({
      isDisposed: () => disposed,
      setUnsubscribe: (next) => {
        unsubscribe = next
      }
    }).catch((error) => console.warn('[structured-session-tabs] sync failed', error))
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [ready])
}
