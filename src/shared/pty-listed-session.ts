/**
 * One row of `pty:listSessions`. Shared so the main handler, both preload surfaces, and the
 * renderer cannot drift on which evidence the UI is allowed to see.
 */
export type PtyListedSession = {
  id: string
  cwd: string
  title: string
  /**
   * An agent holds this session, so work is running regardless of whether the calling renderer
   * has a tab binding for it yet. Positive ownership evidence the renderer cannot derive alone —
   * dropping it at this boundary is what let Resource Manager force-kill live sessions (#8459).
   */
  hasAgentOwner: boolean
}
