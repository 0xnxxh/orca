import {
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  ftruncateSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'

export const MAX_RETAINED_FISH_HISTORY_PATHS = 16
export const MAX_FISH_HISTORY_META_BYTES = 32 * 1024
const MAX_PATH_CANDIDATES = MAX_RETAINED_FISH_HISTORY_PATHS * 4

type DirectoryIdentity = {
  directoryDevice: string
  directoryInode: string
  directoryBirthtimeNs: string
}
type FileIdentity = { fileDevice: string; fileInode: string; fileBirthtimeNs: string }
type Location = DirectoryIdentity & FileIdentity & { path: string }

function reverseWithoutMutation<T>(items: readonly T[]): T[] {
  const result: T[] = []
  for (let index = items.length - 1; index >= 0; index -= 1) {
    result.push(items[index] as T)
  }
  return result
}

const safeSession = (session: unknown): session is string =>
  typeof session === 'string' && /^orca_[0-9a-f]{1,64}$/.test(session)
const canonicalPath = (session: string, path: unknown): path is string =>
  typeof path === 'string' &&
  Boolean(path) &&
  safeSession(session) &&
  isAbsolute(path) &&
  resolve(path) === path &&
  basename(dirname(path)) === 'fish' &&
  basename(path) === `${session}_history`

function directoryIdentity(path: string): DirectoryIdentity | null {
  const directory = dirname(path)
  const root = parse(directory).root
  let current = root
  try {
    const segments = relative(root, directory).split(sep).filter(Boolean)
    const candidates =
      segments.length === 0 ? [root] : segments.map((segment) => (current = join(current, segment)))
    let identity: DirectoryIdentity | null = null
    for (const candidate of candidates) {
      const stat = lstatSync(candidate, { bigint: true })
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        return null
      }
      identity = {
        directoryDevice: stat.dev.toString(),
        directoryInode: stat.ino.toString(),
        directoryBirthtimeNs: stat.birthtimeNs.toString()
      }
    }
    return identity
  } catch {
    return null
  }
}
function fileIdentity(fd: number): FileIdentity | null {
  const stat = fstatSync(fd, { bigint: true })
  return stat.isFile()
    ? {
        fileDevice: stat.dev.toString(),
        fileInode: stat.ino.toString(),
        fileBirthtimeNs: stat.birthtimeNs.toString()
      }
    : null
}
function sameFile(actual: FileIdentity, expected: FileIdentity): boolean {
  return (
    actual.fileDevice === expected.fileDevice &&
    actual.fileInode === expected.fileInode &&
    actual.fileBirthtimeNs === expected.fileBirthtimeNs
  )
}
function sameDirectory(
  stat: { isDirectory(): boolean; dev: bigint; ino: bigint; birthtimeNs: bigint },
  expected: DirectoryIdentity
): boolean {
  return (
    stat.isDirectory() &&
    stat.dev.toString() === expected.directoryDevice &&
    stat.ino.toString() === expected.directoryInode &&
    stat.birthtimeNs.toString() === expected.directoryBirthtimeNs
  )
}

function clearFile(
  path: string,
  directoryExpected: DirectoryIdentity,
  fileExpected: FileIdentity
): boolean {
  let directoryFd: number | undefined
  let fileFd: number | undefined
  try {
    const flags =
      fsConstants.O_RDONLY |
      (process.platform === 'win32' ? 0 : fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW)
    directoryFd = openSync(dirname(path), flags)
    if (!sameDirectory(fstatSync(directoryFd, { bigint: true }), directoryExpected)) {
      return false
    }
    const filePath =
      process.platform === 'win32'
        ? path
        : join(
            process.platform === 'linux' ? '/proc/self/fd' : '/dev/fd',
            String(directoryFd),
            basename(path)
          )
    fileFd = openSync(
      filePath,
      fsConstants.O_RDWR | (process.platform === 'win32' ? 0 : fsConstants.O_NOFOLLOW)
    )
    const actual = fileIdentity(fileFd)
    if (!actual || !sameFile(actual, fileExpected)) {
      return false
    }
    ftruncateSync(fileFd, 0)
    return true
  } catch {
    return false
  } finally {
    if (fileFd !== undefined) {
      closeSync(fileFd)
    }
    if (directoryFd !== undefined) {
      closeSync(directoryFd)
    }
  }
}

function readLocations(path: string, session: string): Location[] {
  try {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_FISH_HISTORY_META_BYTES) {
      return []
    }
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return []
    }
    const record = raw as Record<string, unknown>
    if (
      record.version !== 2 ||
      record.fishSession !== session ||
      !Array.isArray(record.locations)
    ) {
      return []
    }
    const result: Location[] = []
    const seen = new Set<string>()
    for (const candidate of reverseWithoutMutation(record.locations.slice(-MAX_PATH_CANDIDATES))) {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
        continue
      }
      const value = candidate as Record<string, unknown>
      if (
        !canonicalPath(session, value.path) ||
        seen.has(value.path) ||
        ![
          'directoryDevice',
          'directoryInode',
          'directoryBirthtimeNs',
          'fileDevice',
          'fileInode',
          'fileBirthtimeNs'
        ].every((key) => typeof value[key] === 'string')
      ) {
        continue
      }
      seen.add(value.path)
      result.push(value as unknown as Location)
      if (result.length === MAX_RETAINED_FISH_HISTORY_PATHS) {
        break
      }
    }
    return reverseWithoutMutation(result)
  } catch {
    return []
  }
}

export function attestFishHistoryLocation(
  attestationPath: string,
  session: string,
  historyPath: string | null
): void {
  if (!historyPath || !canonicalPath(session, historyPath)) {
    return
  }
  try {
    mkdirSync(dirname(historyPath), { recursive: true, mode: 0o700 })
    const directory = directoryIdentity(historyPath)
    if (!directory) {
      return
    }
    let fd: number | undefined
    try {
      try {
        const stat = lstatSync(historyPath)
        if (stat.isSymbolicLink() || !stat.isFile()) {
          return
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          return
        }
      }
      fd = openSync(
        historyPath,
        fsConstants.O_RDWR |
          fsConstants.O_CREAT |
          (process.platform === 'win32' ? 0 : fsConstants.O_NOFOLLOW),
        0o600
      )
      const file = fileIdentity(fd)
      if (!file) {
        return
      }
      const previous = readLocations(attestationPath, session)
      const active = previous.at(-1)
      if (
        active?.path === historyPath &&
        sameFile(file, active) &&
        active.directoryDevice === directory.directoryDevice &&
        active.directoryInode === directory.directoryInode &&
        active.directoryBirthtimeNs === directory.directoryBirthtimeNs
      ) {
        return
      }
      const locations = [
        ...previous.filter((entry) => entry.path !== historyPath),
        { path: historyPath, ...directory, ...file }
      ].slice(-MAX_RETAINED_FISH_HISTORY_PATHS)
      mkdirSync(dirname(attestationPath), { recursive: true, mode: 0o700 })
      if (existsSync(attestationPath) && lstatSync(attestationPath).isSymbolicLink()) {
        return
      }
      writeFileSync(
        attestationPath,
        JSON.stringify({ version: 2, fishSession: session, locations }),
        { mode: 0o600 }
      )
    } finally {
      if (fd !== undefined) {
        closeSync(fd)
      }
    }
  } catch (error) {
    console.warn(
      `[pty:history] Failed to attest fish history location: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

export function deleteFishHistoryFile(session: string, attestationPath: string): void {
  const locations = readLocations(attestationPath, session)
  if (locations.length === 0) {
    return
  }
  let removed = false
  for (const location of locations) {
    const directory = directoryIdentity(location.path)
    if (
      !directory ||
      directory.directoryDevice !== location.directoryDevice ||
      directory.directoryInode !== location.directoryInode ||
      directory.directoryBirthtimeNs !== location.directoryBirthtimeNs
    ) {
      continue
    }
    removed = clearFile(location.path, directory, location) || removed
  }
  if (!removed) {
    console.warn(`[pty:history] No attested fish history file found for session ${session}`)
  }
}
