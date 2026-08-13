import { rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  attestFishHistoryLocation,
  deleteFishHistoryFile,
  fishHistorySessionName,
  resolveFishHistoryFilePath
} from '../main/fish-history-session'
import { hashWorktreeId } from '../main/terminal-history-id'

function metadataRoot(): string {
  return join(homedir(), '.orca-remote', 'fish-history')
}

function metadataPath(worktreeId: string, root: string): string {
  return join(root, `${hashWorktreeId(worktreeId)}.json`)
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
  attestFishHistoryLocation(metadataPath(worktreeId, root), session, activePath)
}

export function deleteRelayFishHistory(worktreeId: string, root = metadataRoot()): void {
  const session = fishHistorySessionName(hashWorktreeId(worktreeId))
  deleteFishHistoryFile(session, metadataPath(worktreeId, root))
  try {
    rmSync(metadataPath(worktreeId, root), { force: true })
  } catch (error) {
    console.warn(
      `[pty:history] Failed to delete relay fish metadata: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}
