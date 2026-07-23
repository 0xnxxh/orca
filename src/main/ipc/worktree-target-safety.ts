import { lstat, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

function isAlreadyExistsError(error: unknown): boolean {
  return (error as { code?: unknown })?.code === 'EEXIST'
}

export async function worktreeTargetExists(target: string): Promise<boolean> {
  try {
    // Why: detect broken symlinks too, so materialization never overwrites them.
    await lstat(target)
    return true
  } catch {
    return false
  }
}

export async function ensureSafeWorktreeTargetParent(
  worktreePath: string,
  target: string,
  verifiedDirectories: Set<string>
): Promise<boolean> {
  const worktreeRoot = resolve(worktreePath)
  const uncheckedDirectories: string[] = []
  let current = dirname(target)
  while (!verifiedDirectories.has(current)) {
    const parent = dirname(current)
    if (current === worktreeRoot || parent === current) {
      return false
    }
    uncheckedDirectories.push(current)
    current = parent
  }

  for (const directory of uncheckedDirectories.toReversed()) {
    try {
      await mkdir(directory)
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        return false
      }
    }
    try {
      const directoryStats = await lstat(directory)
      if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
        return false
      }
    } catch {
      return false
    }
    verifiedDirectories.add(directory)
  }
  return true
}
