import type Database from '../../sqlite/sync-database'
import type { DispatchContextRow, DispatchStatus } from './types'

export type ContextOnlyDispatchReleaseState = 'abandoned' | 'stopped' | DispatchStatus

export type ContextOnlyDispatchReleaseResult = {
  state: ContextOnlyDispatchReleaseState
  alreadySettled: boolean
  releasedCurrentTask: boolean
}

export function releaseContextOnlyDispatch(
  db: Database.Database,
  dispatch: DispatchContextRow,
  latestDispatchId: string | undefined,
  requestedState: 'abandoned' | 'stopped'
): ContextOnlyDispatchReleaseResult {
  if (dispatch.status !== 'pending' && dispatch.status !== 'dispatched') {
    return {
      state: persistedReleaseState(dispatch),
      alreadySettled: true,
      releasedCurrentTask: latestDispatchId === dispatch.id
    }
  }

  db.prepare(
    `UPDATE dispatch_contexts
     SET status = 'failed', last_failure = ?,
         capability_revoked_at = COALESCE(capability_revoked_at, datetime('now')),
         completed_at = COALESCE(completed_at, datetime('now'))
     WHERE id = ? AND status IN ('pending', 'dispatched')`
  ).run(requestedState, dispatch.id)
  const remaining = db
    .prepare(
      `SELECT 1 FROM dispatch_contexts
       WHERE task_id = ? AND status IN ('pending', 'dispatched') LIMIT 1`
    )
    .get(dispatch.task_id)
  const releasedCurrentTask = latestDispatchId === dispatch.id && !remaining
  if (releasedCurrentTask) {
    db.prepare("UPDATE tasks SET status = 'blocked' WHERE id = ?").run(dispatch.task_id)
  }
  return { state: requestedState, alreadySettled: false, releasedCurrentTask }
}

function persistedReleaseState(dispatch: DispatchContextRow): ContextOnlyDispatchReleaseState {
  return dispatch.last_failure === 'abandoned' || dispatch.last_failure === 'stopped'
    ? dispatch.last_failure
    : dispatch.status
}
