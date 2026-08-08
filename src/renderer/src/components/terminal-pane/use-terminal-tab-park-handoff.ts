import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import type { TerminalTab } from '../../../../shared/types'
import { useAppStore } from '../../store'
import {
  activatePreparedParkedTerminalTabWatchers,
  disposeParkedTerminalWatchersForWorktree,
  getParkedTerminalWatcherEntry,
  isParkedTerminalTabPreparationCurrent,
  selectParkedTerminalPaneCandidateKey,
  syncParkedTerminalTabWatchers,
  type ParkedTabWatcherEntry
} from './terminal-parked-tab-watchers'

const EMPTY_TERMINAL_LAYOUTS_BY_TAB_ID: ReturnType<
  typeof useAppStore.getState
>['terminalLayoutsByTabId'] = {}

function haveSamePreparedWatcherEntries(
  left: ReadonlyMap<string, ParkedTabWatcherEntry>,
  right: ReadonlyMap<string, ParkedTabWatcherEntry>
): boolean {
  if (left.size !== right.size) {
    return false
  }
  for (const [tabId, entry] of left) {
    if (right.get(tabId) !== entry) {
      return false
    }
  }
  return true
}

function selectPreparedParkedTerminalTabIds(args: {
  worktreeId: string
  terminalTabs: readonly TerminalTab[]
  desiredParkedTabIds: ReadonlySet<string>
  preparedWatcherEntriesByTabId: ReadonlyMap<string, ParkedTabWatcherEntry>
  paneCandidateKey: string
}): Set<string> {
  // Why: the key invalidates preparations after leaf, active-leaf, or PTY changes.
  void args.paneCandidateKey
  const parked = new Set<string>()
  for (const terminalTab of args.terminalTabs) {
    if (
      args.desiredParkedTabIds.has(terminalTab.id) &&
      args.preparedWatcherEntriesByTabId.has(terminalTab.id) &&
      isParkedTerminalTabPreparationCurrent(args.worktreeId, terminalTab)
    ) {
      parked.add(terminalTab.id)
    }
  }
  return parked
}

export function useTerminalTabParkHandoff(args: {
  worktreeId: string
  terminalTabs: readonly TerminalTab[]
  desiredParkedTabIds: ReadonlySet<string>
  shouldTrackPaneCandidates: boolean
  activationDeferredMountTabIds?: ReadonlySet<string> | null
}): ReadonlySet<string> {
  const [preparedWatcherEntriesByTabId, setPreparedWatcherEntriesByTabId] = useState<
    ReadonlyMap<string, ParkedTabWatcherEntry>
  >(() => new Map())
  const trackPaneCandidates =
    args.shouldTrackPaneCandidates || preparedWatcherEntriesByTabId.size > 0
  const terminalLayoutsByTabId = useAppStore((state) =>
    trackPaneCandidates ? state.terminalLayoutsByTabId : EMPTY_TERMINAL_LAYOUTS_BY_TAB_ID
  )
  // Why: unrelated store traffic must not rescan every terminal layout.
  const paneCandidateKey = useMemo(
    () =>
      trackPaneCandidates
        ? selectParkedTerminalPaneCandidateKey({ terminalLayoutsByTabId }, args.terminalTabs)
        : '',
    [args.terminalTabs, terminalLayoutsByTabId, trackPaneCandidates]
  )
  const parkedTabIds = useMemo(
    () =>
      selectPreparedParkedTerminalTabIds({
        worktreeId: args.worktreeId,
        terminalTabs: args.terminalTabs,
        desiredParkedTabIds: args.desiredParkedTabIds,
        preparedWatcherEntriesByTabId,
        paneCandidateKey
      }),
    [
      args.desiredParkedTabIds,
      args.terminalTabs,
      args.worktreeId,
      paneCandidateKey,
      preparedWatcherEntriesByTabId
    ]
  )

  useLayoutEffect(() => {
    const failedTabIds = activatePreparedParkedTerminalTabWatchers({
      worktreeId: args.worktreeId,
      tabs: args.terminalTabs,
      parkedTabIds
    })
    if (failedTabIds.size > 0) {
      setPreparedWatcherEntriesByTabId((current) => {
        const next = new Map(current)
        for (const tabId of failedTabIds) {
          next.delete(tabId)
        }
        return next
      })
    }
  }, [args.terminalTabs, args.worktreeId, parkedTabIds])

  // Child readers mount before preparation and reveal successors before disposal.
  useEffect(() => {
    const preparedTabIds = syncParkedTerminalTabWatchers({
      worktreeId: args.worktreeId,
      tabs: args.terminalTabs,
      parkedTabIds,
      desiredParkedTabIds: args.desiredParkedTabIds,
      restoreTitleOnStartTabIds: args.activationDeferredMountTabIds ?? undefined
    })
    const preparedEntries = new Map<string, ParkedTabWatcherEntry>()
    for (const tabId of preparedTabIds) {
      const entry = getParkedTerminalWatcherEntry(tabId)
      if (entry) {
        preparedEntries.set(tabId, entry)
      }
    }
    setPreparedWatcherEntriesByTabId((current) =>
      haveSamePreparedWatcherEntries(current, preparedEntries) ? current : preparedEntries
    )
  }, [
    args.activationDeferredMountTabIds,
    args.desiredParkedTabIds,
    args.terminalTabs,
    args.worktreeId,
    paneCandidateKey,
    parkedTabIds
  ])

  useEffect(
    () => () => disposeParkedTerminalWatchersForWorktree(args.worktreeId),
    [args.worktreeId]
  )

  return parkedTabIds
}
