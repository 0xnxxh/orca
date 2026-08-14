import type { AgentStatusEntry } from './agent-status-types'

/**
 * True when a `working` row is held up only by registered background work
 * (background shell, subagent, monitor, session cron) whose owning foreground
 * turn already ended — Claude sitting at its idle `❯` prompt (#14253 / STA-4119).
 *
 * Presentation-only. The row stays `working` everywhere that gates on `state`
 * (liveness, keep-awake, auto-hibernation, teardown), because the background
 * work is genuinely running; only surfaces that render FOREGROUND activity
 * consult this.
 */
export function isBackgroundOnlyAgentActivity(
  entry: Pick<AgentStatusEntry, 'state' | 'backgroundOnly'> | undefined
): boolean {
  return entry?.state === 'working' && entry.backgroundOnly === true
}
