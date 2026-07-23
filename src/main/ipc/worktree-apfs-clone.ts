import { execFile, type ExecFileOptions } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, stat, rm, link, rmdir, chmod } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { promisify } from 'node:util'

type ExecFileAsync = (
  file: string,
  args: readonly string[],
  options?: Pick<ExecFileOptions, 'timeout'>
) => Promise<{ stdout: string; stderr: string }>

const execFileAsync = promisify(execFile) as ExecFileAsync
// Why: bound the df/diskutil volume probes so a wedged mount can't stall worktree creation.
const APFS_FILESYSTEM_PROBE_TIMEOUT_MS = 5_000

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
  const { stdout: dfOutput } = await deps.execFileAsync('/bin/df', ['-P', path], {
    timeout: APFS_FILESYSTEM_PROBE_TIMEOUT_MS
  })
  const device = dfOutput.trim().split(/\r?\n/)[1]?.trim().split(/\s+/)[0]
  if (!device) {
    throw new Error(`Could not resolve filesystem device for ${path}`)
  }
  const { stdout: diskutilOutput } = await deps.execFileAsync(
    '/usr/sbin/diskutil',
    ['info', '-plist', device],
    { timeout: APFS_FILESYSTEM_PROBE_TIMEOUT_MS }
  )
  const filesystemNameMatch = /<key>FilesystemName<\/key>\s*<string>([^<]+)<\/string>/u.exec(
    diskutilOutput
  )
  return {
    device,
    filesystemName: filesystemNameMatch?.[1] ?? ''
  }
}

async function assertSameApfsVolume(
  source: string,
  target: string,
  deps: ApfsCloneDeps
): Promise<void> {
  const [sourceInfo, targetInfo] = await Promise.all([
    getDarwinFilesystemInfo(source, deps),
    getDarwinFilesystemInfo(dirname(target), deps)
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
  deps: ApfsCloneDeps
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
    // Why: copy `source/.` into the reserved target so contents land at the
    // requested path even when the source is a symlinked directory.
    await deps.execFileAsync('/bin/cp', ['-n', '-c', '-R', `${source}${sep}.`, target])
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
  deps: ApfsCloneDeps = defaultApfsCloneDeps
): Promise<void> {
  await mkdir(dirname(target), { recursive: true })
  await assertSameApfsVolume(source, target, deps)
  // Why: Node's COPYFILE_FICLONE_FORCE returns ENOSYS on macOS in our runtime,
  // while Darwin's cp exposes APFS clonefile via -c. Preflight the volume so
  // cp's non-APFS full-copy fallback cannot surprise users.
  await (sourceIsDirectory
    ? cloneDirectoryWithApfs(source, target, deps)
    : cloneFileWithApfs(source, target, deps))
}
