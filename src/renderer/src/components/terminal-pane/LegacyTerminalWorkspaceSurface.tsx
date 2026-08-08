import { memo, useMemo } from 'react'
import { createPortal } from 'react-dom'
import type { TerminalTab } from '../../../../shared/types'
import {
  findActivityTerminalPortal,
  type ActivityTerminalPortalTarget
} from '../activity/activity-terminal-portal'
import { shouldMountBackgroundWorktreeTab } from '../terminal/background-terminal-worktree-mount'
import TerminalPane from './TerminalPane'
import { canWatcherCoverParkedTerminalTab } from './terminal-parked-tab-watchers'
import { useTerminalTabParkHandoff } from './use-terminal-tab-park-handoff'

export const LegacyTerminalWorkspaceSurface = memo(function LegacyTerminalWorkspaceSurface({
  worktreeId,
  worktreePath,
  terminalTabs,
  activeTabId,
  isVisible,
  isTerminalTabTypeActive,
  shouldMeasureHiddenWorktree,
  shouldColdParkTerminalPanes,
  activityTerminalPortals,
  evictionExemptTerminalTabIds,
  backgroundMountTabIds,
  activationDeferredMountTabIds,
  onPtyExit,
  onCloseTab
}: {
  worktreeId: string
  worktreePath: string
  terminalTabs: readonly TerminalTab[]
  activeTabId: string | null
  isVisible: boolean
  isTerminalTabTypeActive: boolean
  shouldMeasureHiddenWorktree: boolean
  shouldColdParkTerminalPanes: boolean
  activityTerminalPortals: ActivityTerminalPortalTarget[]
  evictionExemptTerminalTabIds: ReadonlySet<string>
  backgroundMountTabIds: ReadonlySet<string> | null
  activationDeferredMountTabIds: ReadonlySet<string> | null
  onPtyExit: (tabId: string, ptyId: string) => void
  onCloseTab: (tabId: string) => void
}): React.JSX.Element {
  const desiredParkedTerminalTabIds = useMemo(() => {
    const parked = new Set<string>()
    for (const tab of terminalTabs) {
      const hasActivityPortal =
        findActivityTerminalPortal(activityTerminalPortals, {
          worktreeId,
          tabId: tab.id
        }) !== null
      if (
        shouldColdParkTerminalPanes &&
        !hasActivityPortal &&
        !evictionExemptTerminalTabIds.has(tab.id)
      ) {
        parked.add(tab.id)
      }
      if (
        activationDeferredMountTabIds?.has(tab.id) &&
        !hasActivityPortal &&
        canWatcherCoverParkedTerminalTab(worktreeId, tab)
      ) {
        parked.add(tab.id)
      }
    }
    return parked
  }, [
    activationDeferredMountTabIds,
    activityTerminalPortals,
    evictionExemptTerminalTabIds,
    shouldColdParkTerminalPanes,
    terminalTabs,
    worktreeId
  ])
  const parkedTerminalTabIds = useTerminalTabParkHandoff({
    worktreeId,
    terminalTabs,
    desiredParkedTabIds: desiredParkedTerminalTabIds,
    shouldTrackPaneCandidates:
      shouldColdParkTerminalPanes || (activationDeferredMountTabIds?.size ?? 0) > 0,
    activationDeferredMountTabIds
  })

  return (
    <div
      className={
        isVisible
          ? 'absolute inset-0'
          : shouldMeasureHiddenWorktree
            ? 'absolute inset-0 opacity-0 pointer-events-none'
            : 'absolute inset-0 hidden'
      }
      aria-hidden={!isVisible}
    >
      {terminalTabs
        .filter((tab) => shouldMountBackgroundWorktreeTab(backgroundMountTabIds, tab.id))
        .map((tab) => {
          const activityTerminalPortal = findActivityTerminalPortal(activityTerminalPortals, {
            worktreeId,
            tabId: tab.id
          })
          if (parkedTerminalTabIds.has(tab.id)) {
            return null
          }
          const isActiveTerminalTab = isVisible && tab.id === activeTabId && isTerminalTabTypeActive
          const terminalPane = (
            <TerminalPane
              key={`${tab.id}-${tab.generation ?? 0}`}
              tabId={tab.id}
              terminalGeneration={tab.generation ?? 0}
              worktreeId={worktreeId}
              cwd={tab.startupCwd ?? worktreePath}
              isActive={isActiveTerminalTab || activityTerminalPortal?.active === true}
              isVisible={isActiveTerminalTab || activityTerminalPortal !== null}
              isWorktreeActive={isVisible || activityTerminalPortal !== null}
              isolatedPaneKey={activityTerminalPortal?.paneKey ?? null}
              onPtyExit={(ptyId) => onPtyExit(tab.id, ptyId)}
              onCloseTab={() => onCloseTab(tab.id)}
            />
          )
          return activityTerminalPortal
            ? createPortal(
                terminalPane,
                activityTerminalPortal.target,
                `activity-terminal-${tab.id}`
              )
            : terminalPane
        })}
    </div>
  )
})
