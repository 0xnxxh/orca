import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { rmSync } from 'node:fs'

/**
 * Per-worktree fish history, which fish models as a session NAME rather than a path.
 *
 * fish ignores HISTFILE entirely: history lives at
 * `$XDG_DATA_HOME/fish/${fish_history}_history` (default session "fish"), so the
 * only isolation knob is `fish_history`. fish imports environment variables as
 * global variables at startup, so exporting `fish_history` in the spawn env picks
 * the session without an `--init-command` — verified against fish 4.7.1.
 *
 * Consequence: the file lands in the USER's fish data dir, not Orca's history
 * root, so it cannot be tombstoned with the rest of a worktree's history tree —
 * `deleteFishHistoryFile` removes it directly instead.
 *
 * Two more fish facts for anyone reading these files: history is written only in
 * INTERACTIVE mode, and the format is a YAML-ish record list (`- cmd: …` /
 * `  when: …`), not the one-line-per-command form bash and zsh use.
 */
const SESSION_PREFIX = 'orca_'
// Why: the name becomes a filename and is only ever built from a hex hash; anything
// else means a caller drifted, and refusing beats deleting an unexpected path.
const SAFE_SESSION_NAME = /^orca_[0-9a-f]{1,64}$/

export function fishHistorySessionName(worktreeHash: string): string {
  return `${SESSION_PREFIX}${worktreeHash}`
}

/** Absolute path fish writes a session's history to, or null when it is not resolvable. */
export function resolveFishHistoryFilePath(
  session: string,
  env: NodeJS.ProcessEnv = process.env
): string | null {
  if (!SAFE_SESSION_NAME.test(session)) {
    return null
  }
  const xdgDataHome = env.XDG_DATA_HOME?.trim()
  // Why: fish ignores a relative XDG_DATA_HOME and falls back to the home default.
  const dataHome =
    xdgDataHome && isAbsolute(xdgDataHome)
      ? xdgDataHome
      : join(env.HOME?.trim() || homedir(), '.local', 'share')
  return join(dataHome, 'fish', `${session}_history`)
}

/** Best-effort removal of one worktree's fish history file. */
export function deleteFishHistoryFile(session: string, env: NodeJS.ProcessEnv = process.env): void {
  const path = resolveFishHistoryFilePath(session, env)
  if (!path) {
    return
  }
  try {
    rmSync(path, { force: true })
  } catch (err) {
    console.warn(
      `[pty:history] Failed to delete fish history ${session}: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}
