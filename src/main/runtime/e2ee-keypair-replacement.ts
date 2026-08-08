import { existsSync, renameSync, rmSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fsyncDirectorySync, renameFileDurableSync } from '../../shared/durable-file-write'

type ReplacementOptions = {
  platform?: NodeJS.Platform
  verify?: () => void
  rename?: (source: string, destination: string) => void
  remove?: (path: string) => void
  retainBackup?: boolean
}

export function verifiedReplacementBackupPath(activePath: string): string {
  return join(dirname(activePath), `.${basename(activePath)}.backup`)
}

/** Publishes a validated stage while retaining a recoverable Windows rollback. */
export function replaceVerifiedKeypairStage(
  stagePath: string,
  activePath: string,
  options: ReplacementOptions = {}
): void {
  const platform = options.platform ?? process.platform
  const move = options.rename ?? renameSync
  const remove = options.remove ?? ((path: string) => rmSync(path, { force: true }))
  const removeDurable = (path: string): void => {
    remove(path)
    fsyncDirectorySync(dirname(path))
  }
  const renameDurable = (source: string, destination: string): void => {
    renameFileDurableSync(source, destination, { move })
  }
  if (platform !== 'win32' || !existsSync(activePath)) {
    renameDurable(stagePath, activePath)
    options.verify?.()
    return
  }

  const backupPath = verifiedReplacementBackupPath(activePath)
  if (existsSync(backupPath)) {
    if (existsSync(activePath)) {
      removeDurable(backupPath)
    } else {
      renameDurable(backupPath, activePath)
    }
  }
  let oldActiveMoved = false
  let newActivePublished = false
  try {
    renameDurable(activePath, backupPath)
    oldActiveMoved = true
    renameDurable(stagePath, activePath)
    newActivePublished = true
    options.verify?.()
    if (!options.retainBackup) {
      removeDurable(backupPath)
    }
  } catch (error) {
    if (newActivePublished) {
      removeDurable(activePath)
    }
    if (oldActiveMoved && existsSync(backupPath)) {
      renameDurable(backupPath, activePath)
    }
    throw error
  }
}
