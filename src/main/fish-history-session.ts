import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import {
  attestFishHistoryLocation,
  deleteFishHistoryFile,
  MAX_FISH_HISTORY_META_BYTES,
  MAX_RETAINED_FISH_HISTORY_PATHS
} from './fish-history-location-attestation'

export {
  attestFishHistoryLocation,
  deleteFishHistoryFile,
  MAX_FISH_HISTORY_META_BYTES,
  MAX_RETAINED_FISH_HISTORY_PATHS
}
export const FISH_HISTORY_LOCATION_ATTESTATION = 'fish-history-locations.json'
const SESSION_PREFIX = 'orca_'
const SAFE_SESSION_NAME = /^orca_[0-9a-f]{1,64}$/
const MAX_PATH_CANDIDATES = MAX_RETAINED_FISH_HISTORY_PATHS * 4

export function isSafeFishHistorySession(session: unknown): session is string {
  return typeof session === 'string' && SAFE_SESSION_NAME.test(session)
}
export function fishHistorySessionName(worktreeHash: string): string {
  return `${SESSION_PREFIX}${worktreeHash}`
}
export function resolveFishHistoryFilePath(
  session: string,
  env: NodeJS.ProcessEnv = process.env
): string | null {
  if (!isSafeFishHistorySession(session)) {
    return null
  }
  const xdg = env.XDG_DATA_HOME?.trim()
  const dataHome =
    xdg && isAbsolute(xdg) ? xdg : join(env.HOME?.trim() || homedir(), '.local', 'share')
  return join(dataHome, 'fish', `${session}_history`)
}
function canonicalPath(session: string, path: unknown): path is string {
  return (
    typeof path === 'string' &&
    Boolean(path) &&
    isSafeFishHistorySession(session) &&
    isAbsolute(path) &&
    resolve(path) === path &&
    basename(dirname(path)) === 'fish' &&
    basename(path) === `${session}_history`
  )
}
export function normalizeFishHistoryPaths(
  session: string,
  singularPath: unknown,
  paths: readonly unknown[] | undefined
): string[] {
  const newestFirst: string[] = []
  const seen = new Set<string>()
  const retain = (path: unknown): void => {
    if (!canonicalPath(session, path) || seen.has(path)) {
      return
    }
    seen.add(path)
    newestFirst.push(path)
  }
  for (const path of (paths ?? []).slice(-MAX_PATH_CANDIDATES).toReversed()) {
    retain(path)
    if (newestFirst.length === MAX_RETAINED_FISH_HISTORY_PATHS) {
      break
    }
  }
  if (newestFirst.length < MAX_RETAINED_FISH_HISTORY_PATHS) {
    retain(singularPath)
  }
  return newestFirst.toReversed().slice(-MAX_RETAINED_FISH_HISTORY_PATHS)
}
