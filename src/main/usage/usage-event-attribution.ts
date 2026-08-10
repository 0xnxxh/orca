import { posix, win32 } from 'node:path'
import { isWindowsAbsolutePathLike } from '../../shared/cross-platform-path'
import { areWorktreePathsEqual } from '../ipc/worktree-logic'
import {
  canonicalizeUsageWorktreePaths,
  type CanonicalizedUsageWorktree
} from '../usage-worktree-canonicalizer'
import { getLocalUsageDay } from './usage-calendar-range'
import {
  canonicalizeUsagePath,
  normalizeComparablePath,
  normalizeFsPath
} from './usage-path-comparison'
import type { UsageScanWorktreeRef } from './usage-provider-contract'

type UsageAttributableEvent = {
  timestamp: string
  cwd: string | null
}

export type UsageEventAttribution = {
  day: string
  projectKey: string
  projectLabel: string
  repoId: string | null
  worktreeId: string | null
}

export type UsageAttributionWorktree = CanonicalizedUsageWorktree<UsageScanWorktreeRef>

export function canonicalizeUsageAttributionWorktrees(
  worktrees: readonly UsageScanWorktreeRef[]
): Promise<UsageAttributionWorktree[]> {
  return canonicalizeUsageWorktreePaths(worktrees, canonicalizeUsagePath)
}

function getDefaultProjectLabel(cwd: string | null): string {
  if (!cwd) {
    return 'Unknown location'
  }
  const parts = cwd.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts.length >= 2 ? parts.slice(-2).join('/') : (parts.at(-1) ?? cwd)
}

function isContainingPath(candidatePath: string, targetPath: string): boolean {
  const useWin32 = isWindowsAbsolutePathLike(candidatePath) || isWindowsAbsolutePathLike(targetPath)
  const pathApi = useWin32 ? win32 : posix
  const relativePath = pathApi.relative(candidatePath, targetPath)
  if (!relativePath) {
    return true
  }
  // Windows returns an absolute target when paths use different drives.
  if (pathApi.isAbsolute(relativePath)) {
    return false
  }
  // Only `..` and `../...` escape; `..name` is a valid child.
  return (
    relativePath !== '..' && !relativePath.startsWith(`..${pathApi.sep}`) && relativePath !== '.'
  )
}

function findContainingWorktree(
  cwd: string,
  worktrees: readonly UsageAttributionWorktree[]
): UsageAttributionWorktree | null {
  const normalizedCwd = normalizeFsPath(cwd)
  return (
    worktrees.find(
      (worktree) =>
        areWorktreePathsEqual(worktree.canonicalPath, normalizedCwd) ||
        isContainingPath(worktree.canonicalPath, normalizedCwd)
    ) ?? null
  )
}

export function attributeUsageEvent<Event extends UsageAttributableEvent>(
  event: Event,
  worktrees: readonly UsageAttributionWorktree[]
): (Event & UsageEventAttribution) | null {
  const day = getLocalUsageDay(event.timestamp)
  if (!day) {
    return null
  }

  const worktree = event.cwd ? findContainingWorktree(event.cwd, worktrees) : null
  return {
    ...event,
    day,
    projectKey: worktree
      ? `worktree:${worktree.worktreeId}`
      : event.cwd
        ? `cwd:${normalizeComparablePath(event.cwd)}`
        : 'unscoped',
    projectLabel: worktree?.displayName ?? getDefaultProjectLabel(event.cwd),
    repoId: worktree?.repoId ?? null,
    worktreeId: worktree?.worktreeId ?? null
  }
}
