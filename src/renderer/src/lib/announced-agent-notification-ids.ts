/**
 * The notification ids a pane's agent completions were actually announced under,
 * held until that pane is acknowledged.
 *
 * Why a registry: a Claude background turn announces its banner under the
 * turn-complete stamp while the pane's status row stays on the working boundary,
 * so acknowledge cannot re-derive the id from the store. Successive background
 * turns each announce a distinct id, so every unacknowledged id has to be kept.
 */

// Why bounded: a pane that is never acknowledged (backgrounded worktree, long
// agent session) would otherwise accumulate one id per turn for the app's life.
const MAX_TRACKED_PANES = 128
const MAX_IDS_PER_PANE = 16

const announcedIdsByPaneKey = new Map<string, string[]>()

export function recordAnnouncedAgentNotificationId(paneKey: string, notificationId: string): void {
  const ids = announcedIdsByPaneKey.get(paneKey) ?? []
  // Why: re-announcing an id replaces the same OS banner, so one dismissal covers it.
  if (ids.includes(notificationId)) {
    return
  }
  ids.push(notificationId)
  if (ids.length > MAX_IDS_PER_PANE) {
    ids.splice(0, ids.length - MAX_IDS_PER_PANE)
  }
  // Re-insert so map order stays least-recently-announced first for eviction.
  announcedIdsByPaneKey.delete(paneKey)
  announcedIdsByPaneKey.set(paneKey, ids)
  while (announcedIdsByPaneKey.size > MAX_TRACKED_PANES) {
    const oldestPaneKey = announcedIdsByPaneKey.keys().next().value
    if (oldestPaneKey === undefined) {
      return
    }
    announcedIdsByPaneKey.delete(oldestPaneKey)
  }
}

/** Returns the pane's announced ids in announcement order and forgets them. */
export function takeAnnouncedAgentNotificationIds(paneKey: string): readonly string[] {
  const ids = announcedIdsByPaneKey.get(paneKey)
  if (!ids) {
    return []
  }
  announcedIdsByPaneKey.delete(paneKey)
  return ids
}

export function resetAnnouncedAgentNotificationIdsForTest(): void {
  announcedIdsByPaneKey.clear()
}
