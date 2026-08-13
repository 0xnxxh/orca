import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  ftruncateSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync
} from 'node:fs'

/**
 * Per-worktree fish history, which fish models as a session NAME rather than a path.
 *
 * fish ignores HISTFILE entirely: history lives at
 * `$XDG_DATA_HOME/fish/${fish_history}_history` (default session "fish"), so the
 * only isolation knob is `fish_history`. fish imports environment variables as
 * global variables at startup, so exporting `fish_history` in the spawn env picks
 * the session without an `--init-command` — verified against fish 4.7.1.
 *
 * Consequence: the file lands in the USER's fish data dir, not Orca's history
 * root, so it cannot be tombstoned with the rest of a worktree's history tree —
 * `deleteFishHistoryFile` removes it directly instead.
 *
 * Two more fish facts for anyone reading these files: history is written only in
 * INTERACTIVE mode, and the format is a YAML-ish record list (`- cmd: …` /
 * `  when: …`), not the one-line-per-command form bash and zsh use.
 */
const SESSION_PREFIX = 'orca_'
// Why: the name becomes a filename and is only ever built from a hex hash; anything
// else means a caller drifted, and refusing beats deleting an unexpected path.
const SAFE_SESSION_NAME = /^orca_[0-9a-f]{1,64}$/

export const MAX_RETAINED_FISH_HISTORY_PATHS = 16
export const MAX_FISH_HISTORY_META_BYTES = 32 * 1024
const MAX_FISH_HISTORY_PATH_CANDIDATES = MAX_RETAINED_FISH_HISTORY_PATHS * 4
export const FISH_HISTORY_LOCATION_ATTESTATION = 'fish-history-locations.json'

type FishHistoryLocationAttestation = {
  path: string
  directoryDevice: string
  directoryInode: string
  directoryBirthtimeNs: string
}
type FishHistoryDirectoryIdentity = Omit<FishHistoryLocationAttestation, 'path'>

export function isSafeFishHistorySession(session: unknown): session is string {
  return typeof session === 'string' && SAFE_SESSION_NAME.test(session)
}

export function fishHistorySessionName(worktreeHash: string): string {
  return `${SESSION_PREFIX}${worktreeHash}`
}

/** Absolute path fish writes a session's history to, or null when it is not resolvable. */
export function resolveFishHistoryFilePath(
  session: string,
  env: NodeJS.ProcessEnv = process.env
): string | null {
  if (!isSafeFishHistorySession(session)) {
    return null
  }
  const xdgDataHome = env.XDG_DATA_HOME?.trim()
  // Why: fish ignores a relative XDG_DATA_HOME and falls back to the home default.
  const dataHome =
    xdgDataHome && isAbsolute(xdgDataHome)
      ? xdgDataHome
      : join(env.HOME?.trim() || homedir(), '.local', 'share')
  return join(dataHome, 'fish', `${session}_history`)
}

/** Validate path shape only; deletion authority comes from a separate identity attestation. */
function isCanonicalFishHistoryPath(session: string, path: unknown): path is string {
  return Boolean(
    typeof path === 'string' &&
    path &&
    isSafeFishHistorySession(session) &&
    isAbsolute(path) &&
    resolve(path) === path &&
    basename(dirname(path)) === 'fish' &&
    basename(path) === `${session}_history`
  )
}

function fishHistoryDirectoryIdentity(path: string): FishHistoryDirectoryIdentity | null {
  const directory = dirname(path)
  const root = parse(directory).root
  let current = root
  try {
    const segments = relative(root, directory).split(sep).filter(Boolean)
    const roots =
      segments.length === 0 ? [root] : segments.map((segment) => (current = join(current, segment)))
    let identity: FishHistoryDirectoryIdentity | null = null
    for (const candidate of roots) {
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

/** Clear through an attested directory handle; never unlink a pathname after checking it. */
function clearFishHistoryFile(path: string): boolean {
  const directory = dirname(path)
  let directoryFd: number | undefined
  let fileFd: number | undefined
  try {
    directoryFd = openSync(
      directory,
      fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW
    )
    if (process.platform === 'win32') {
      return false
    }
    const fdRoot = process.platform === 'linux' ? '/proc/self/fd' : '/dev/fd'
    fileFd = openSync(join(fdRoot, String(directoryFd), basename(path)), fsConstants.O_RDWR)
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

function readFishHistoryLocationAttestations(
  attestationPath: string,
  session: string
): FishHistoryLocationAttestation[] {
  try {
    const stat = lstatSync(attestationPath)
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_FISH_HISTORY_META_BYTES) {
      return []
    }
    const raw: unknown = JSON.parse(readFileSync(attestationPath, 'utf8'))
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return []
    }
    const record = raw as Record<string, unknown>
    if (
      record.version !== 1 ||
      record.fishSession !== session ||
      !Array.isArray(record.locations)
    ) {
      return []
    }
    const candidates = record.locations.slice(-MAX_FISH_HISTORY_PATH_CANDIDATES)
    const retained: FishHistoryLocationAttestation[] = []
    const seen = new Set<string>()
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
      const candidate = candidates[index]
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
        continue
      }
      const location = candidate as Record<string, unknown>
      if (
        !isCanonicalFishHistoryPath(session, location.path) ||
        typeof location.directoryDevice !== 'string' ||
        typeof location.directoryInode !== 'string' ||
        typeof location.directoryBirthtimeNs !== 'string' ||
        seen.has(location.path)
      ) {
        continue
      }
      seen.add(location.path)
      retained.push({
        path: location.path,
        directoryDevice: location.directoryDevice,
        directoryInode: location.directoryInode,
        directoryBirthtimeNs: location.directoryBirthtimeNs
      })
      if (retained.length === MAX_RETAINED_FISH_HISTORY_PATHS) {
        break
      }
    }
    return retained.toReversed()
  } catch {
    return []
  }
}

/** Record a spawn-derived fish location outside meta.json, bound to its directory identity. */
export function attestFishHistoryLocation(
  attestationPath: string,
  session: string,
  historyPath: string | null
): void {
  if (!historyPath || !isCanonicalFishHistoryPath(session, historyPath)) {
    return
  }
  try {
    mkdirSync(dirname(historyPath), { recursive: true, mode: 0o700 })
    const identity = fishHistoryDirectoryIdentity(historyPath)
    if (!identity) {
      console.warn(`[pty:history] Refusing to attest symlinked fish history path ${historyPath}`)
      return
    }
    const retained = readFishHistoryLocationAttestations(attestationPath, session)
    const active = retained.at(-1)
    if (
      active?.path === historyPath &&
      active.directoryDevice === identity.directoryDevice &&
      active.directoryInode === identity.directoryInode &&
      active.directoryBirthtimeNs === identity.directoryBirthtimeNs
    ) {
      return
    }
    const existing = retained.filter((entry) => entry.path !== historyPath)
    const locations = [...existing, { path: historyPath, ...identity }].slice(
      -MAX_RETAINED_FISH_HISTORY_PATHS
    )
    mkdirSync(dirname(attestationPath), { recursive: true, mode: 0o700 })
    if (existsSync(attestationPath) && lstatSync(attestationPath).isSymbolicLink()) {
      return
    }
    writeFileSync(
      attestationPath,
      JSON.stringify({ version: 1, fishSession: session, locations }),
      { mode: 0o600 }
    )
  } catch (error) {
    console.warn(
      `[pty:history] Failed to attest fish history location: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

export function normalizeFishHistoryPaths(
  session: string,
  singularPath: unknown,
  paths: readonly unknown[] | undefined
): string[] {
  const recentPaths = (paths ?? []).slice(-MAX_FISH_HISTORY_PATH_CANDIDATES)
  const newestFirst: string[] = []
  const seen = new Set<string>()
  const retain = (path: unknown): void => {
    if (!isCanonicalFishHistoryPath(session, path) || seen.has(path)) {
      return
    }
    seen.add(path)
    newestFirst.push(path)
  }
  for (let index = recentPaths.length - 1; index >= 0; index -= 1) {
    retain(recentPaths[index])
    if (newestFirst.length === MAX_RETAINED_FISH_HISTORY_PATHS) {
      break
    }
  }
  if (newestFirst.length < MAX_RETAINED_FISH_HISTORY_PATHS) {
    retain(singularPath)
  }
  const retained: string[] = []
  for (let index = newestFirst.length - 1; index >= 0; index -= 1) {
    if (retained.length === MAX_RETAINED_FISH_HISTORY_PATHS) {
      break
    }
    retained.push(newestFirst[index])
  }
  return retained
}

/** Delete only spawn-attested locations whose non-symlink directory identity still matches. */
export function deleteFishHistoryFile(session: string, attestationPath: string): void {
  const locations = readFishHistoryLocationAttestations(attestationPath, session)
  if (locations.length === 0) {
    console.warn(`[pty:history] No attested fish history location for session ${session}`)
    return
  }
  let removed = false
  for (const location of locations) {
    try {
      const identity = fishHistoryDirectoryIdentity(location.path)
      if (
        !identity ||
        identity.directoryDevice !== location.directoryDevice ||
        identity.directoryInode !== location.directoryInode ||
        identity.directoryBirthtimeNs !== location.directoryBirthtimeNs
      ) {
        console.warn(`[pty:history] Refusing fish history cleanup after directory identity changed`)
        continue
      }
      if (existsSync(location.path)) {
        const stat = lstatSync(location.path)
        if (stat.isSymbolicLink() || !stat.isFile()) {
          continue
        }
        removed = clearFishHistoryFile(location.path) || removed
      }
    } catch (err) {
      console.warn(
        `[pty:history] Failed to delete fish history ${location.path}: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }
  if (!removed) {
    // Explicit: a config.fish-set XDG_DATA_HOME leaves a file we cannot locate,
    // and silence would hide one leaked history file per deleted worktree.
    console.warn(
      `[pty:history] No attested fish history file found for session ${session}; a config.fish-only XDG_DATA_HOME remains outside Orca's cleanup authority.`
    )
  }
}
