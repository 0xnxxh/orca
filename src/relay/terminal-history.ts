import { mkdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { hashWorktreeId } from '../main/terminal-history-id'

const HISTORY_ROOT = join(homedir(), '.orca-remote', 'terminal-history')

function historyFilename(shell: string): string | null {
  const name = basename(shell).toLowerCase()
  if (name.startsWith('bash')) {
    return 'bash_history'
  }
  if (name.startsWith('zsh')) {
    return 'zsh_history'
  }
  return null
}

export function injectRelayHistoryEnv(
  env: Record<string, string>,
  worktreeId: string,
  shell: string
): string | null {
  if (env.HISTFILE) {
    return null
  }
  const filename = historyFilename(shell)
  if (!filename) {
    return null
  }
  try {
    const dir = join(HISTORY_ROOT, hashWorktreeId(worktreeId))
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    const path = join(dir, filename)
    env.HISTFILE = path
    return dir
  } catch {
    return null
  }
}

export function deleteRelayHistory(worktreeId: string): void {
  try {
    rmSync(join(HISTORY_ROOT, hashWorktreeId(worktreeId)), { recursive: true, force: true })
  } catch (error) {
    console.warn(
      `[pty:history] Failed to delete relay shell history: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}
