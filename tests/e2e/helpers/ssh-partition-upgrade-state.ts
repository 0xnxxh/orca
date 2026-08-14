/**
 * Stage the on-disk shape an upgrading user actually carries.
 *
 * Earlier builds wrote SSH pane membership into `workspaceSessionsByHostId["ssh:<target>"]`. The
 * build under test reads `local` and its reattach refuses to create, so without a migration every
 * pane is refused and the user's tabs are discarded. Reproducing that needs a profile where the
 * panes live ONLY in the partition — which no live writer produces any more, so it has to be
 * staged offline.
 *
 * Records are MOVED wholesale, never synthesized. A hand-built tab missing `ptyId`, `customTitle`,
 * `color`, `sortOrder` or `createdAt` is silently dropped by `tabsByWorktree` salvage at load, and
 * the test then measures an empty partition and passes for the wrong reason. That has already
 * happened once on this work.
 *
 * Call only while the app is closed — a running app holds this state in memory and overwrites the
 * file on its next flush.
 */
import { readFileSync, writeFileSync } from 'node:fs'

type MutableState = {
  settings?: { sshHoistedTabIds?: string[] }
  workspaceSession?: {
    tabsByWorktree?: Record<string, { id: string }[]>
    terminalLayoutsByTabId?: Record<string, unknown>
    terminalPtyIncarnationsByPaneKey?: Record<string, string>
    activeTabIdByWorktree?: Record<string, string | null>
  }
  workspaceSessionsByHostId?: Record<string, unknown>
}

export function movePanesIntoSshPartition(
  stateFile: string,
  targetId: string,
  worktreeId: string
): { movedTabIds: string[]; movedLayouts: number; diagnostics: string } {
  const state = JSON.parse(readFileSync(stateFile, 'utf-8')) as MutableState
  const local = (state.workspaceSession ??= {})
  const partitionId = `ssh:${targetId}`

  const tabs = local.tabsByWorktree?.[worktreeId] ?? []
  const tabIds = new Set(tabs.map((tab) => tab.id))

  const layouts: Record<string, unknown> = {}
  for (const [tabId, layout] of Object.entries(local.terminalLayoutsByTabId ?? {})) {
    if (tabIds.has(tabId)) {
      layouts[tabId] = layout
    }
  }
  const incarnations: Record<string, string> = {}
  for (const [paneKey, incarnation] of Object.entries(
    local.terminalPtyIncarnationsByPaneKey ?? {}
  )) {
    if (tabIds.has(paneKey.split(':')[0] ?? '')) {
      incarnations[paneKey] = incarnation
    }
  }

  state.workspaceSessionsByHostId ??= {}
  state.workspaceSessionsByHostId[partitionId] = {
    ...((state.workspaceSessionsByHostId[partitionId] as Record<string, unknown>) ?? {}),
    tabsByWorktree: { [worktreeId]: tabs },
    terminalLayoutsByTabId: layouts,
    terminalPtyIncarnationsByPaneKey: incarnations,
    activeTabIdByWorktree: { [worktreeId]: local.activeTabIdByWorktree?.[worktreeId] ?? null }
  }

  delete local.tabsByWorktree?.[worktreeId]
  for (const tabId of tabIds) {
    delete local.terminalLayoutsByTabId?.[tabId]
  }
  for (const paneKey of Object.keys(incarnations)) {
    delete local.terminalPtyIncarnationsByPaneKey?.[paneKey]
  }
  delete local.activeTabIdByWorktree?.[worktreeId]
  // The build under test stamps hoisted tabs; an upgrading profile has no such stamp.
  delete state.settings?.sshHoistedTabIds

  writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`, 'utf-8')
  return {
    movedTabIds: [...tabIds],
    movedLayouts: Object.keys(layouts).length,
    diagnostics: `partition=${partitionId} tabs=${tabIds.size} layouts=${Object.keys(layouts).length} incarnations=${Object.keys(incarnations).length}`
  }
}
