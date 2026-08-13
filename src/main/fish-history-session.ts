import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { existsSync, rmSync } from 'node:fs'

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

export const MAX_RETAINED_FISH_HISTORY_PATHS = 16
export const MAX_FISH_HISTORY_META_BYTES = 32 * 1024
const MAX_FISH_HISTORY_PATH_CANDIDATES = MAX_RETAINED_FISH_HISTORY_PATHS * 4

export function isSafeFishHistorySession(session: unknown): session is string {
  return typeof session === 'string' && SAFE_SESSION_NAME.test(session)
}

export function fishHistorySessionName(worktreeHash: string): string {
  return `${SESSION_PREFIX}${worktreeHash}`
}

/** Absolute path fish writes a session's history to, or null when it is not resolvable. */
export function resolveFishHistoryFilePath(
  session: string,
  env: NodeJS.ProcessEnv = process.env
): string | null {
  if (!isSafeFishHistorySession(session)) {
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

/**
 * Accepts a path recorded at spawn time only if it still names this session's own
 * history file, so a tampered meta.json cannot steer `rmSync` somewhere else.
 */
export function isTrustedFishHistoryPath(session: string, path: unknown): path is string {
  return Boolean(
    typeof path === 'string' &&
    path &&
    isSafeFishHistorySession(session) &&
    isAbsolute(path) &&
    basename(dirname(path)) === 'fish' &&
    basename(path) === `${session}_history`
  )
}

export function normalizeFishHistoryPaths(
  session: string,
  singularPath: unknown,
  paths: readonly unknown[] | undefined
): string[] {
  const recentPaths = (paths ?? []).slice(-MAX_FISH_HISTORY_PATH_CANDIDATES)
  const newestFirst: string[] = []
  const seen = new Set<string>()
  const retain = (path: unknown): void => {
    if (!isTrustedFishHistoryPath(session, path) || seen.has(path)) {
      return
    }
    seen.add(path)
    newestFirst.push(path)
  }
  for (let index = recentPaths.length - 1; index >= 0; index -= 1) {
    retain(recentPaths[index])
    if (newestFirst.length === MAX_RETAINED_FISH_HISTORY_PATHS) {
      break
    }
  }
  if (newestFirst.length < MAX_RETAINED_FISH_HISTORY_PATHS) {
    retain(singularPath)
  }
  const retained: string[] = []
  for (let index = newestFirst.length - 1; index >= 0; index -= 1) {
    if (retained.length === MAX_RETAINED_FISH_HISTORY_PATHS) {
      break
    }
    retained.push(newestFirst[index])
  }
  return retained
}

/**
 * Removes one worktree's fish history file.
 *
 * `recordedPath` is the path resolved from the PTY's own spawn env when the
 * session was minted; the main process env is only a fallback, because the two
 * disagree whenever Orca was launched with a different `XDG_DATA_HOME`/`HOME`
 * than the shells it spawns.
 *
 * Neither can see a `set -gx XDG_DATA_HOME …` that lives inside the user's
 * config.fish — fish resolves that after we have handed off. That file cannot be
 * found from here, so it is reported instead of being dropped silently.
 */
export function deleteFishHistoryFile(
  session: string,
  options: {
    recordedPath?: string | null
    recordedPaths?: readonly unknown[]
    env?: NodeJS.ProcessEnv
  } = {}
): void {
  const candidates = new Set<string>()
  if (isTrustedFishHistoryPath(session, options.recordedPath)) {
    candidates.add(options.recordedPath)
  }
  for (const path of (options.recordedPaths ?? []).slice(0, MAX_RETAINED_FISH_HISTORY_PATHS)) {
    if (isTrustedFishHistoryPath(session, path)) {
      candidates.add(path)
    }
  }
  const fromEnv = resolveFishHistoryFilePath(session, options.env ?? process.env)
  if (fromEnv) {
    candidates.add(fromEnv)
  }
  if (candidates.size === 0) {
    return
  }
  let removed = false
  for (const path of candidates) {
    try {
      removed ||= existsSync(path)
      rmSync(path, { force: true })
    } catch (err) {
      console.warn(
        `[pty:history] Failed to delete fish history ${path}: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }
  if (!removed) {
    // Explicit: a config.fish-set XDG_DATA_HOME leaves a file we cannot locate,
    // and silence would hide one leaked history file per deleted worktree.
    console.warn(
      `[pty:history] No fish history file found for session ${session}; if fish keeps history outside ${[...candidates].join(' or ')} (e.g. XDG_DATA_HOME set in config.fish) that file is left behind.`
    )
  }
}
