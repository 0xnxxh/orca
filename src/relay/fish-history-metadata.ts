import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  deleteFishHistoryFile,
  fishHistorySessionName,
  MAX_FISH_HISTORY_META_BYTES,
  normalizeFishHistoryPaths,
  resolveFishHistoryFilePath
} from '../main/fish-history-session'
import { hashWorktreeId } from '../main/terminal-history-id'

function metadataRoot(): string {
  return join(homedir(), '.orca-remote', 'fish-history')
}

function metadataPath(worktreeId: string, root: string): string {
  return join(root, `${hashWorktreeId(worktreeId)}.json`)
}

function readPaths(worktreeId: string, root: string): string[] {
  try {
    const file = metadataPath(worktreeId, root)
    if (statSync(file).size > MAX_FISH_HISTORY_META_BYTES) {
      return []
    }
    const raw: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return []
    }
    const record = raw as Record<string, unknown>
    const session = fishHistorySessionName(hashWorktreeId(worktreeId))
    if (record.fishSession !== session) {
      return []
    }
    return normalizeFishHistoryPaths(
      session,
      record.fishHistoryPath,
      Array.isArray(record.fishHistoryPaths) ? record.fishHistoryPaths : undefined
    )
  } catch {
    return []
  }
}

export function recordRelayFishHistoryPath(
  worktreeId: string,
  env: NodeJS.ProcessEnv,
  root = metadataRoot()
): void {
  const session = fishHistorySessionName(hashWorktreeId(worktreeId))
  const activePath = resolveFishHistoryFilePath(session, env)
  if (!activePath) {
    return
  }
  try {
    const paths = normalizeFishHistoryPaths(session, undefined, [
      ...readPaths(worktreeId, root),
      activePath
    ])
    mkdirSync(root, { recursive: true, mode: 0o700 })
    writeFileSync(
      metadataPath(worktreeId, root),
      JSON.stringify({
        fishSession: session,
        fishHistoryPath: activePath,
        fishHistoryPaths: paths
      }),
      { mode: 0o600 }
    )
  } catch (error) {
    console.warn(
      `[pty:history] Failed to record relay fish history: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

export function deleteRelayFishHistory(
  worktreeId: string,
  root = metadataRoot(),
  env: NodeJS.ProcessEnv = process.env
): void {
  const session = fishHistorySessionName(hashWorktreeId(worktreeId))
  deleteFishHistoryFile(session, { recordedPaths: readPaths(worktreeId, root), env })
  try {
    rmSync(metadataPath(worktreeId, root), { force: true })
  } catch (error) {
    console.warn(
      `[pty:history] Failed to delete relay fish metadata: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}
