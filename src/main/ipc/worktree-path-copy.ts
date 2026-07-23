import { chmod, cp, lstat, mkdir, rmdir, stat } from 'node:fs/promises'
import { dirname, relative } from 'node:path'
import { worktreeTargetExists } from './worktree-target-safety'

type WorktreePathCopyOptions = {
  existingLinkedDescendants: ReadonlySet<string>
  platform: NodeJS.Platform
}

function isAlreadyExistsError(error: unknown): boolean {
  return (error as { code?: unknown })?.code === 'EEXIST'
}

export function normalizeWorktreeRelativePath(
  relativePath: string,
  platform: NodeJS.Platform
): string {
  const normalized = relativePath.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '')
  return platform === 'win32' ? normalized.toLowerCase() : normalized
}

async function shouldCopySourcePath(
  sourceRoot: string,
  sourcePath: string,
  targetPath: string,
  options: WorktreePathCopyOptions
): Promise<boolean> {
  const relativeSourcePath = normalizeWorktreeRelativePath(
    relative(sourceRoot, sourcePath),
    options.platform
  )
  // Returning false for a directory prunes its subtree, so descendants need no extra lstat.
  const isConfiguredLinkedPath = options.existingLinkedDescendants.has(relativeSourcePath)
  return !isConfiguredLinkedPath || !(await worktreeTargetExists(targetPath))
}

export async function copyWorktreePath(
  source: string,
  target: string,
  sourceIsDirectory: boolean,
  options: WorktreePathCopyOptions
): Promise<void> {
  await mkdir(dirname(target), { recursive: true })
  if (!sourceIsDirectory) {
    await cp(source, target, {
      recursive: true,
      force: false,
      errorOnExist: false,
      dereference: false,
      verbatimSymlinks: true
    })
    return
  }

  const sourceMode = (await stat(source)).mode & 0o777
  let createdTarget = false
  try {
    await mkdir(target, { mode: sourceMode })
    createdTarget = true
  } catch (error) {
    if (!isAlreadyExistsError(error)) {
      throw error
    }
    if (options.existingLinkedDescendants.size === 0) {
      return
    }
    const targetStats = await lstat(target)
    if (!targetStats.isDirectory() || targetStats.isSymbolicLink()) {
      return
    }
  }

  try {
    await cp(source, target, {
      recursive: true,
      force: false,
      errorOnExist: false,
      dereference: false,
      // Why: preserve relative nested links without rewriting them back into the primary.
      verbatimSymlinks: true,
      ...(options.existingLinkedDescendants.size > 0
        ? {
            filter: (sourcePath: string, targetPath: string) =>
              shouldCopySourcePath(source, sourcePath, targetPath, options)
          }
        : {})
    })
    if (createdTarget && process.platform !== 'win32') {
      await chmod(target, sourceMode)
    }
  } catch (error) {
    // Preserve partial output for diagnosis; remove only an empty reservation.
    if (createdTarget) {
      await rmdir(target).catch(() => undefined)
    }
    throw error
  }
}
