import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, stat, rm, link, rmdir, chmod } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { promisify } from 'node:util'

type ExecFileAsync = (
  file: string,
  args: readonly string[]
) => Promise<{ stdout: string; stderr: string }>

const execFileAsync = promisify(execFile) as ExecFileAsync

export type ApfsCloneDeps = {
  execFileAsync: ExecFileAsync
  randomUUID: () => string
}

export const defaultApfsCloneDeps: ApfsCloneDeps = {
  execFileAsync,
  randomUUID
}

type DarwinFilesystemInfo = {
  device: string
  filesystemName: string
}

export type ApfsCloneFilesystemCache = Map<number, Promise<DarwinFilesystemInfo>>

export type ApfsCloneOptions = {
  dereferenceSymlinks?: boolean
  filesystemCache?: ApfsCloneFilesystemCache
}

export class ApfsCloneUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ApfsCloneUnavailableError'
  }
}

export class WorktreeLinkedPathTargetExistsError extends Error {
  constructor(target: string) {
    super(`Worktree linked path target already exists: ${target}`)
    this.name = 'WorktreeLinkedPathTargetExistsError'
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return (error as { code?: unknown })?.code === 'EEXIST'
}

async function getDarwinFilesystemInfo(
  path: string,
  deps: ApfsCloneDeps
): Promise<DarwinFilesystemInfo> {
  const { stdout: dfOutput } = await deps.execFileAsync('/bin/df', ['-P', path])
  const device = dfOutput.trim().split(/\r?\n/)[1]?.trim().split(/\s+/)[0]
  if (!device) {
    throw new Error(`Could not resolve filesystem device for ${path}`)
  }
  const { stdout: diskutilOutput } = await deps.execFileAsync('/usr/sbin/diskutil', [
    'info',
    '-plist',
    device
  ])
  const filesystemNameMatch = /<key>FilesystemName<\/key>\s*<string>([^<]+)<\/string>/u.exec(
    diskutilOutput
  )
  return {
    device,
    filesystemName: filesystemNameMatch?.[1] ?? ''
  }
}

async function getCachedDarwinFilesystemInfo(
  path: string,
  deps: ApfsCloneDeps,
  cache: ApfsCloneFilesystemCache
): Promise<DarwinFilesystemInfo> {
  const deviceId = (await stat(path)).dev
  const cached = cache.get(deviceId)
  if (cached) {
    return cached
  }
  const pending = getDarwinFilesystemInfo(path, deps)
  cache.set(deviceId, pending)
  try {
    return await pending
  } catch (error) {
    cache.delete(deviceId)
    throw error
  }
}

async function assertSameApfsVolume(
  source: string,
  target: string,
  deps: ApfsCloneDeps,
  cache: ApfsCloneFilesystemCache
): Promise<void> {
  const [sourceInfo, targetInfo] = await Promise.all([
    getCachedDarwinFilesystemInfo(source, deps, cache),
    getCachedDarwinFilesystemInfo(dirname(target), deps, cache)
  ])
  if (
    sourceInfo.device !== targetInfo.device ||
    sourceInfo.filesystemName !== 'APFS' ||
    targetInfo.filesystemName !== 'APFS'
  ) {
    throw new ApfsCloneUnavailableError(
      'APFS clone-copy requires source and target on the same APFS volume'
    )
  }
}

async function cloneFileWithApfs(
  source: string,
  target: string,
  deps: ApfsCloneDeps
): Promise<void> {
  const tempTarget = resolve(dirname(target), `.orca-apfs-clone-${deps.randomUUID()}`)
  try {
    await deps.execFileAsync('/bin/cp', ['-c', source, tempTarget])
    try {
      // Why: link(2) is an atomic no-clobber publish for files; rename(2) can
      // overwrite a target that appeared after the earlier existence check.
      await link(tempTarget, target)
    } catch (error) {
      if (isAlreadyExistsError(error)) {
        throw new WorktreeLinkedPathTargetExistsError(target)
      }
      throw error
    }
  } finally {
    await rm(tempTarget, { force: true }).catch(() => undefined)
  }
}

async function cloneDirectoryWithApfs(
  source: string,
  target: string,
  deps: ApfsCloneDeps,
  dereferenceSymlinks: boolean
): Promise<void> {
  const sourceMode = (await stat(source)).mode & 0o777
  try {
    // Why: reserve the final directory path before copying into it so a raced
    // user-created directory cannot be replaced by a final rename.
    await mkdir(target)
  } catch (error) {
    if (isAlreadyExistsError(error)) {
      throw new WorktreeLinkedPathTargetExistsError(target)
    }
    throw error
  }

  try {
    // Why: the top-level directory is reserved before cp runs, so use `-n`
    // to keep a raced nested file from being overwritten during the copy.
    await deps.execFileAsync('/bin/cp', [
      '-n',
      '-c',
      '-R',
      ...(dereferenceSymlinks ? ['-L'] : []),
      source,
      dirname(target)
    ])
    await chmod(target, sourceMode)
  } catch (error) {
    // Why: remove only the empty reservation. If cp wrote anything, or another
    // process raced files into the directory, leave it for Git/user review.
    await rmdir(target).catch(() => undefined)
    throw error
  }
}

export async function cloneWorktreePathWithApfs(
  source: string,
  target: string,
  sourceIsDirectory: boolean,
  deps: ApfsCloneDeps = defaultApfsCloneDeps,
  options: ApfsCloneOptions = {}
): Promise<void> {
  const targetParent = dirname(target)
  await mkdir(targetParent, { recursive: true })
  await assertSameApfsVolume(source, target, deps, options.filesystemCache ?? new Map())
  // Why: Node's COPYFILE_FICLONE_FORCE returns ENOSYS on macOS in our runtime,
  // while Darwin's cp exposes APFS clonefile via -c. Preflight the volume so
  // cp's non-APFS full-copy fallback cannot surprise users.
  await (sourceIsDirectory
    ? cloneDirectoryWithApfs(source, target, deps, options.dereferenceSymlinks === true)
    : cloneFileWithApfs(source, target, deps))
}
