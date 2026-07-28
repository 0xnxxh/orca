import { parseAppSshPtyId } from '../../shared/ssh-pty-id'

/** How long after startup the sweep runs. Terminal restore binds panes to their
 *  daemon sessions in a burst right after launch; waiting keeps a pane that is
 *  simply not reattached yet from reading as one whose agent process is gone. */
export const RESTORED_SUBAGENT_LIVENESS_SWEEP_DELAY_MS = 2 * 60 * 1000

export type RestoredSubagentLivenessSweepDeps = {
  /** Live local PTY session ids, or null when the inventory could not be read —
   *  an unavailable listing is not evidence that anything exited. */
  listLiveLocalPtyIds: () => Promise<readonly string[] | null>
  /** PTY bound to this pane in the current session, if it has one. */
  getBoundPtyIdForPaneKey: (paneKey: string) => string | undefined
  /** PTY this pane was bound to when the session was last persisted; covers panes
   *  whose surviving daemon session has not been reattached yet. */
  getPersistedPtyIdForPaneKey: (paneKey: string) => string | undefined
  reap: (isLocalPaneAgentLive: (paneKey: string) => boolean) => number
}

/** Cross-check restored Claude subagent rows against the live local PTY inventory
 *  and drop the ones no agent process can still be running. Panes launched over
 *  SSH resolve as live unconditionally: their agent runs on the remote host and
 *  can never appear here, so scanning for it would prune every live remote row. */
export async function sweepRestoredSubagentsWithoutLiveAgent(
  deps: RestoredSubagentLivenessSweepDeps
): Promise<number> {
  const liveIds = await deps.listLiveLocalPtyIds()
  if (!liveIds) {
    return 0
  }
  const livePtyIds = new Set(liveIds)
  return deps.reap((paneKey) => {
    const ptyId = deps.getBoundPtyIdForPaneKey(paneKey) ?? deps.getPersistedPtyIdForPaneKey(paneKey)
    if (!ptyId) {
      return false
    }
    if (parseAppSshPtyId(ptyId)) {
      return true
    }
    return livePtyIds.has(ptyId)
  })
}

/** Index the persisted terminal layouts as `paneKey -> ptyId`. Layout leaves are
 *  the only persisted binding that carries a stable pane key, so tab-level PTY ids
 *  (legacy numeric panes) are deliberately skipped. */
export function indexPersistedPaneKeyPtyIds(
  layoutsByTabId: Record<string, { ptyIdsByLeafId?: Record<string, string> } | undefined>
): Map<string, string> {
  const byPaneKey = new Map<string, string>()
  for (const [tabId, layout] of Object.entries(layoutsByTabId)) {
    for (const [leafId, ptyId] of Object.entries(layout?.ptyIdsByLeafId ?? {})) {
      if (ptyId) {
        byPaneKey.set(`${tabId}:${leafId}`, ptyId)
      }
    }
  }
  return byPaneKey
}
