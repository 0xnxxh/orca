import type { UnifiedSessionRow } from './resource-usage-merge-types'

/**
 * Whether killing this session must ask first.
 *
 * Skipping the prompt is only safe when Orca can show what would be lost — a bound row has a tab
 * the user can look at. Absence of a binding is not evidence the session is idle, and agent
 * ownership is positive evidence it is not: an agent holds live work with no tab of its own.
 * Resource Manager force-killed exactly those sessions with no prompt (#8459).
 */
export function requiresKillConfirmation(session: UnifiedSessionRow): boolean {
  return session.bound || session.hasAgentOwner
}
