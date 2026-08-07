import { randomUUID } from 'node:crypto'
import type { Stats } from 'node:fs'
import { copyFile, link, lstat, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const ATOMIC_NO_REPLACE_UNSUPPORTED_CODE = 'ORCA_ATOMIC_NO_REPLACE_UNSUPPORTED'

export async function copySessionFileWithoutOverwrite(
  sourcePath: string,
  targetPath: string
): Promise<void> {
  const temporaryPath = join(dirname(targetPath), `.orca-backfill-${randomUUID()}.tmp`)
  // Why: stage cross-volume copies away from the rollout filename so a failed
  // copy cannot strand a truncated session that a later retry would skip.
  await writeFile(temporaryPath, '', { encoding: 'utf-8', flag: 'wx', mode: 0o600 })
  try {
    await copyStableSessionFile(sourcePath, temporaryPath)
    try {
      // Why: this same-volume hardlink atomically installs the staged copy
      // without risking a collision overwrite after an EXDEV fallback.
      await link(temporaryPath, targetPath)
    } catch (installLinkError) {
      if (isExistsError(installLinkError)) {
        throw installLinkError
      }
      if (!isHardlinkUnsupportedError(installLinkError)) {
        throw installLinkError
      }
      // Why: Node has no portable atomic rename-if-absent. Fail closed on a
      // hardlink-less target instead of risking replacement of a concurrent file.
      throw makeAtomicNoReplaceUnsupportedError(targetPath, installLinkError)
    }
  } finally {
    try {
      await rm(temporaryPath, { force: true })
    } catch (error) {
      // Why: cleanup trouble must not misreport a successfully installed
      // rollout as a copy failure; the .tmp file is ignored by Codex.
      console.warn('[codex-session-backfill] Failed to remove staged copy:', temporaryPath, error)
    }
  }
}

export async function replaceOwnedSessionCopy(
  sourcePath: string,
  targetPath: string,
  expectedTargetStat: Stats
): Promise<void> {
  const temporaryPath = join(dirname(targetPath), `.orca-backfill-${randomUUID()}.tmp`)
  await writeFile(temporaryPath, '', { encoding: 'utf-8', flag: 'wx', mode: 0o600 })
  try {
    await copyStableSessionFile(sourcePath, temporaryPath)
    const currentTargetStat = await lstat(targetPath)
    if (!fileStatsMatch(currentTargetStat, expectedTargetStat)) {
      const error = new Error(`Owned backfill target changed before refresh: ${targetPath}`)
      ;(error as NodeJS.ErrnoException).code = 'EEXIST'
      throw error
    }
    await rename(temporaryPath, targetPath)
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

async function copyStableSessionFile(sourcePath: string, targetPath: string): Promise<void> {
  const sourceStatBefore = await lstat(sourcePath)
  await copyFile(sourcePath, targetPath)
  const sourceStatAfter = await lstat(sourcePath)
  if (!fileStatsMatch(sourceStatAfter, sourceStatBefore)) {
    const error = new Error(`Session changed while it was copied: ${sourcePath}`)
    ;(error as NodeJS.ErrnoException).code = 'EBUSY'
    throw error
  }
}

function fileStatsMatch(left: Stats, right: Stats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.birthtimeMs === right.birthtimeMs &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  )
}

function isExistsError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'EEXIST'
}

function isHardlinkUnsupportedError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code
  return (
    code === 'EPERM' ||
    code === 'EACCES' ||
    code === 'ENOTSUP' ||
    code === 'EOPNOTSUPP' ||
    code === 'ENOSYS'
  )
}

function makeAtomicNoReplaceUnsupportedError(
  targetPath: string,
  cause: unknown
): NodeJS.ErrnoException {
  const error = new Error(
    `Cannot atomically install backfill without overwrite on this filesystem: ${targetPath}`,
    { cause }
  ) as NodeJS.ErrnoException
  error.code = ATOMIC_NO_REPLACE_UNSUPPORTED_CODE
  return error
}

export function isAtomicNoReplaceUnsupportedError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === ATOMIC_NO_REPLACE_UNSUPPORTED_CODE
}
