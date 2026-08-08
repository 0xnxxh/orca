import { isPathInsideOrEqual } from '../../shared/cross-platform-path'
import { mapWithConcurrency } from '../../shared/map-with-concurrency'
import { splitWorktreeId, splitWorktreeIdForFilesystem } from '../../shared/worktree-id'
import { listRegisteredPtys } from '../memory/pty-registry'
import { killListedPty } from '../providers/pty-listed-session-kill'
import type { IPtyProvider, PtyProcessInfo } from '../providers/types'

const WORKTREE_TEARDOWN_CONCURRENCY = 32

export type WorktreePtyStop = (
  ptyId: string,
  stop: () => Promise<boolean>
) => Promise<{ stopped: boolean; owner: boolean }>

export async function sweepProviderPtysForWorktree(
  worktreeId: string,
  provider: IPtyProvider,
  deadline: number,
  rpcDeadline: number,
  stopPty: WorktreePtyStop,
  onPtyStopped: ((ptyId: string) => void) | undefined,
  failClosed: boolean,
  loadProviderInventory: () => Promise<PtyProcessInfo[]>
): Promise<number> {
  const belongsToWorktree = createListedPtyWorktreePredicate(worktreeId)
  const sessions = failClosed
    ? await loadProviderInventory()
    : await loadProviderInventory().catch(() => [])
  const sessionsById = indexListedPtysById(sessions)
  const ambiguousIds = new Set(
    sessions
      .filter((session) => sessionsById.get(session.id) === null && belongsToWorktree(session))
      .map((session) => session.id)
  )
  if (failClosed && ambiguousIds.size > 0) {
    throw new Error(`worktree_pty_inventory_ambiguous:${[...ambiguousIds].join(',')}`)
  }
  const candidates = [...sessionsById.values()].filter(
    (session): session is PtyProcessInfo => session !== null && belongsToWorktree(session)
  )
  const stopped = await mapWithConcurrency(
    candidates,
    WORKTREE_TEARDOWN_CONCURRENCY,
    async (session) => {
      if (Date.now() >= deadline) {
        return 0
      }
      const stopResult = await stopPty(session.id, async () => {
        if (Date.now() >= deadline) {
          return false
        }
        try {
          const accepted = await killListedPty(provider, session, {
            immediate: true,
            deadlineMs: rpcDeadline
          })
          return accepted && Date.now() < deadline
        } catch {
          return false
        }
      })
      if (stopResult.owner && Date.now() < deadline) {
        clearStoppedPtyState(session.id, onPtyStopped)
        return 1
      }
      return 0
    }
  )
  return stopped.reduce<number>((count, value) => count + value, 0)
}

export async function sweepRegisteredPtysForWorktree(
  worktreeId: string,
  provider: IPtyProvider,
  deadline: number,
  rpcDeadline: number,
  stopPty: WorktreePtyStop,
  onPtyStopped: ((ptyId: string) => void) | undefined,
  failClosed: boolean,
  loadProviderInventory: () => Promise<PtyProcessInfo[]>
): Promise<number> {
  let providerSessions: PtyProcessInfo[]
  try {
    providerSessions = await loadProviderInventory()
  } catch (error) {
    if (failClosed) {
      throw error
    }
    return 0
  }
  const providerSessionsById = indexListedPtysById(providerSessions)
  const belongsToWorktree = createListedPtyWorktreePredicate(worktreeId)
  const entries = listRegisteredPtys().filter((entry) => entry.worktreeId === worktreeId)
  const stopped = await mapWithConcurrency(
    entries,
    WORKTREE_TEARDOWN_CONCURRENCY,
    async (entry) => {
      if (Date.now() >= deadline) {
        return 0
      }
      const listed = providerSessionsById.get(entry.ptyId)
      if (listed === undefined) {
        if (failClosed) {
          throw new Error(`worktree_pty_inventory_missing:${entry.ptyId}`)
        }
        return 0
      }
      if (listed === null) {
        if (failClosed) {
          throw new Error(`worktree_pty_inventory_ambiguous:${entry.ptyId}`)
        }
        return 0
      }
      if (!belongsToWorktree(listed)) {
        if (failClosed) {
          throw new Error(`worktree_pty_inventory_owner_conflict:${entry.ptyId}`)
        }
        return 0
      }
      const stopResult = await stopPty(entry.ptyId, async () => {
        if (Date.now() >= deadline) {
          return false
        }
        try {
          const accepted = await killListedPty(provider, listed, {
            immediate: true,
            deadlineMs: rpcDeadline
          })
          return accepted && Date.now() < deadline
        } catch {
          return false
        }
      })
      if (stopResult.owner && Date.now() < deadline) {
        clearStoppedPtyState(entry.ptyId, onPtyStopped)
        return 1
      }
      return 0
    }
  )
  return stopped.reduce<number>((count, value) => count + value, 0)
}

function createListedPtyWorktreePredicate(
  worktreeId: string
): (session: PtyProcessInfo) => boolean {
  const prefix = `${worktreeId}@@`
  // Why: folder-workspace instances share a checkout path, so cwd alone cannot distinguish them.
  const fullWorktreePath = splitWorktreeId(worktreeId)?.worktreePath
  const cwdFallbackPath =
    splitWorktreeIdForFilesystem(worktreeId)?.worktreePath === fullWorktreePath
      ? fullWorktreePath
      : undefined
  return (session) => {
    // Why: older rows may omit cwd; exact ID and authoritative worktree ownership remain usable.
    const cwdOwned =
      cwdFallbackPath !== undefined &&
      session.worktreeId === undefined &&
      typeof session.cwd === 'string' &&
      session.cwd.length > 0 &&
      isPathInsideOrEqual(cwdFallbackPath, session.cwd)
    return session.id.startsWith(prefix) || session.worktreeId === worktreeId || cwdOwned
  }
}

function indexListedPtysById<T extends { id: string }>(
  sessions: readonly T[]
): Map<string, T | null> {
  const indexed = new Map<string, T | null>()
  for (const session of sessions) {
    indexed.set(session.id, indexed.has(session.id) ? null : session)
  }
  return indexed
}

export function clearStoppedPtyState(ptyId: string, onPtyStopped?: (ptyId: string) => void): void {
  if (!onPtyStopped) {
    return
  }
  try {
    // Why: daemon shutdown may not fan a local exit event back through pty.ts.
    onPtyStopped(ptyId)
  } catch {
    /* cleanup is best-effort and must not block git-level removal */
  }
}
