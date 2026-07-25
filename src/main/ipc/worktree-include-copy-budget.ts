import { lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'

/** Ceiling on what one worktree materialization may copy, measured before any
 *  bytes are written. Both limits are cumulative across the whole run, so a
 *  hundred medium entries trip the same guard one huge entry does. */
export type WorktreeCopyBudget = {
  maxBytes: number
  maxEntries: number
}

// Why: `.worktreeinclude` is a repo-authored list, and a repo that lists
// `node_modules` freezes worktree creation for minutes behind an inline copy
// (macOS gets a cheap APFS clone; Linux/Windows get a full `fs.cp`). These
// limits clear real payloads — `.env` files, `.vscode/`, small build caches —
// and refuse dependency trees. The entry limit matters as much as the byte
// limit: 200k tiny files are slow to copy even though they weigh little.
export const DEFAULT_WORKTREE_COPY_BUDGET: WorktreeCopyBudget = {
  maxBytes: 2 * 1024 * 1024 * 1024,
  maxEntries: 50_000
}

export type WorktreeCopyBudgetExceededReason = 'bytes' | 'entries'

export type WorktreeCopySizeVerdict =
  | { withinBudget: true; bytes: number; entries: number }
  | { withinBudget: false; reason: WorktreeCopyBudgetExceededReason }

export type SkippedWorktreeCopyPath = {
  path: string
  reason: WorktreeCopyBudgetExceededReason
}

export type WorktreeCopyBudgetTracker = {
  /** Measure `source` against what is left of the budget. A `withinBudget`
   *  verdict consumes the measured size; an over-budget verdict consumes
   *  nothing, so later, smaller entries still get their chance. */
  admit: (source: string) => Promise<WorktreeCopySizeVerdict>
}

async function measureCopySize(
  source: string,
  remainingBytes: number,
  remainingEntries: number
): Promise<WorktreeCopySizeVerdict> {
  let bytes = 0
  let entries = 0
  const pending: string[] = [source]
  while (pending.length > 0) {
    const current = pending.pop() as string
    let stats: Awaited<ReturnType<typeof lstat>>
    try {
      stats = await lstat(current)
    } catch {
      // Raced away between the walk and now — the copy will skip it too.
      continue
    }
    entries += 1
    if (entries > remainingEntries) {
      return { withinBudget: false, reason: 'entries' }
    }
    // Why: both copy backends reproduce a nested symlink as a symlink rather
    // than following it, so walking through one would double-count a shared
    // target and could loop forever on a cycle.
    if (stats.isSymbolicLink()) {
      continue
    }
    if (stats.isDirectory()) {
      try {
        for (const name of await readdir(current)) {
          pending.push(join(current, name))
        }
      } catch {
        // Unreadable directory — nothing measurable, and the copy will report it.
      }
      continue
    }
    bytes += stats.size
    if (bytes > remainingBytes) {
      return { withinBudget: false, reason: 'bytes' }
    }
  }
  return { withinBudget: true, bytes, entries }
}

/** Why a pre-measurement pass rather than aborting mid-copy: `fs.cp` ignores
 *  its `signal` option, so a copy that has started cannot be cancelled and
 *  would leave a partial tree behind. Refusing before the first byte is
 *  written keeps the worktree in a state the user can reason about. The walk
 *  is itself bounded — it returns the moment either limit is crossed. */
export function createWorktreeCopyBudgetTracker(
  budget: WorktreeCopyBudget = DEFAULT_WORKTREE_COPY_BUDGET
): WorktreeCopyBudgetTracker {
  let remainingBytes = budget.maxBytes
  let remainingEntries = budget.maxEntries
  return {
    admit: async (source) => {
      const verdict = await measureCopySize(source, remainingBytes, remainingEntries)
      if (verdict.withinBudget) {
        remainingBytes -= verdict.bytes
        remainingEntries -= verdict.entries
      }
      return verdict
    }
  }
}

function formatByteLimit(maxBytes: number): string {
  const gigabytes = maxBytes / (1024 * 1024 * 1024)
  if (gigabytes >= 1) {
    return `${Number(gigabytes.toFixed(1))} GB`
  }
  return `${Math.max(1, Math.round(maxBytes / (1024 * 1024)))} MB`
}

/** User-facing warning for entries the budget refused. Returns undefined when
 *  nothing was skipped so callers can spread it conditionally. */
export function formatWorktreeIncludeCopyWarning(
  skipped: readonly SkippedWorktreeCopyPath[],
  budget: WorktreeCopyBudget = DEFAULT_WORKTREE_COPY_BUDGET
): string | undefined {
  if (skipped.length === 0) {
    return undefined
  }
  const names = skipped.map((entry) => `"${entry.path}"`).join(', ')
  const subject = skipped.length === 1 ? 'entry' : 'entries'
  const verb = skipped.length === 1 ? 'was' : 'were'
  return (
    `.worktreeinclude ${subject} ${names} ${verb} not copied into the new workspace: ` +
    `copying them would exceed the ${formatByteLimit(budget.maxBytes)} / ` +
    `${budget.maxEntries.toLocaleString('en-US')} file limit that keeps workspace creation responsive. ` +
    `Copy them in manually if this workspace needs them.`
  )
}
