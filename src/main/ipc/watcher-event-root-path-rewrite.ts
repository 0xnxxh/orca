/**
 * A worktree reached through a symlink (`~/code` -> `/Volumes/…`, anything under
 * `/tmp` or `/var`) or spelled with different casing than disk on a
 * case-insensitive volume breaks recursive watching, differently per platform:
 *
 * - Linux: `@parcel/watcher` passes `IN_DONT_FOLLOW | IN_ONLYDIR` to
 *   `inotify_add_watch`, so a symlinked root fails outright with ENOTDIR
 *   ("Not a directory"). The watch never installs, and Orca caches the root in
 *   `unwatchableRoots`, so it is not retried for the rest of the session.
 * - macOS: FSEvents installs the watch but reports OS-canonical paths —
 *   symlinks resolved, each directory in its on-disk spelling — so events land
 *   outside the root the caller subscribed with.
 * - Windows: `GetFinalPathNameByHandle` behind `realpath` resolves junctions
 *   and substituted drives the same way.
 *
 * Both failures have the same visible symptom, because every consumer derives a
 * worktree-relative path from the subscribed root and silently drops whatever
 * falls outside it: the editor never reloads an agent's edit, the File Explorer
 * never refreshes, and Source Control never re-runs status.
 *
 * So hand the backend the resolved directory, which is watchable everywhere,
 * then map delivered paths back to the caller's spelling so the "event paths
 * live under worktreePath" contract holds on every platform.
 */
import { realpathSync } from 'node:fs'

export type WatcherEventRootPathRewrite = (eventPath: string) => string

const CASE_INSENSITIVE_PLATFORMS = new Set<NodeJS.Platform>(['darwin', 'win32'])

const identityWatcherEventRootPathRewrite: WatcherEventRootPathRewrite = (eventPath) => eventPath

function isWindowsStyleRoot(rootPath: string): boolean {
  return /^[A-Za-z]:/.test(rootPath) || rootPath.startsWith('\\\\')
}

// Why: backslash is a legal POSIX filename character, so only Windows roots may
// treat it as a separator.
function splitRootSegments(value: string, windowsStyle: boolean): string[] {
  const parts = windowsStyle ? value.split(/[\\/]+/) : value.split('/')
  return parts.filter((part) => part.length > 0)
}

export function createWatcherEventRootPathRewrite(
  requestedRoot: string,
  canonicalRoot: string,
  platform: NodeJS.Platform = process.platform
): WatcherEventRootPathRewrite {
  const windowsStyle = isWindowsStyleRoot(requestedRoot)
  // Why: Windows accepts either separator, so follow the root's own spelling
  // rather than forcing backslashes into a path the caller wrote with slashes.
  const separator = windowsStyle && !requestedRoot.includes('/') ? '\\' : '/'
  const rootSegments = splitRootSegments(canonicalRoot, windowsStyle)
  if (rootSegments.length === 0) {
    return identityWatcherEventRootPathRewrite
  }
  const caseInsensitive = CASE_INSENSITIVE_PLATFORMS.has(platform)
  // Why: fold per segment rather than over the whole path — NFC and case
  // folding both change length, so a folded-prefix length would slice the raw
  // event path mid-character and fabricate a path. Segment counts survive both.
  const fold = (segment: string): string => {
    const normalized = segment.normalize('NFC')
    return caseInsensitive ? normalized.toLowerCase() : normalized
  }
  const foldedRootSegments = rootSegments.map(fold)
  const requestedPrefix = requestedRoot.endsWith(separator)
    ? requestedRoot
    : `${requestedRoot}${separator}`
  // Why: the canonical root carries the OS's own separator, which need not match
  // the spelling the caller subscribed with.
  const canonicalSeparator = windowsStyle && !canonicalRoot.includes('/') ? '\\' : '/'
  const canonicalPrefix = canonicalRoot.endsWith(canonicalSeparator)
    ? canonicalRoot
    : `${canonicalRoot}${canonicalSeparator}`

  return (eventPath) => {
    // Already spelled the way the renderer subscribed — the whole non-macOS world.
    if (eventPath === requestedRoot || eventPath.startsWith(requestedPrefix)) {
      return eventPath
    }
    // A plain symlinked root differs only by prefix; splice it byte-exact so the
    // per-segment fold below is reached only for casing/Unicode differences.
    if (eventPath.startsWith(canonicalPrefix)) {
      return `${requestedPrefix}${eventPath.slice(canonicalPrefix.length)}`
    }
    if (eventPath === canonicalRoot) {
      return requestedRoot
    }
    const segments = splitRootSegments(eventPath, windowsStyle)
    if (segments.length < foldedRootSegments.length) {
      return eventPath
    }
    for (const [index, foldedRootSegment] of foldedRootSegments.entries()) {
      if (fold(segments[index]!) !== foldedRootSegment) {
        return eventPath
      }
    }
    const suffix = segments.slice(foldedRootSegments.length)
    return suffix.length === 0 ? requestedRoot : `${requestedPrefix}${suffix.join(separator)}`
  }
}

export type WatcherRootPaths = {
  /** Directory to hand the watcher backend — symlinks resolved. */
  watchRoot: string
  /** Maps a delivered event path back onto the caller's spelling. */
  rewriteEventPath: WatcherEventRootPathRewrite
}

/**
 * Deliberately synchronous. Every caller reserves and forks its watcher child
 * in the same tick as the subscribe call — capacity accounting and cancellation
 * ordering both depend on it — so an await here would open a window in which a
 * subscribe has been issued but no cancellable child exists. This is one
 * `realpath` per subscribe (not per event), on a directory the caller has
 * usually just stat'd, in a function that already calls `existsSync`.
 */
export function resolveWatcherRootPaths(
  requestedRoot: string,
  deps: {
    realpath?: (candidate: string) => string
    platform?: NodeJS.Platform
  } = {}
): WatcherRootPaths {
  let watchRoot = requestedRoot
  try {
    watchRoot = (deps.realpath ?? realpathSync.native)(requestedRoot)
  } catch {
    // Why: a vanished or unreadable root still gets a watcher attempt, which
    // owns its own failure reporting; fall back to the literal spelling rather
    // than fail here. Resolving the binding inside the try also keeps suites
    // that mock a partial node:fs from failing every watcher install.
  }
  return {
    watchRoot,
    rewriteEventPath: createWatcherEventRootPathRewrite(requestedRoot, watchRoot, deps.platform)
  }
}

/**
 * Returns the original array when nothing needed rewriting so the common
 * per-batch hot path stays allocation-free.
 */
export function applyWatcherEventRootPathRewrite<T extends { path: string }>(
  events: T[],
  rewrite: WatcherEventRootPathRewrite
): T[] {
  let rewritten: T[] | null = null
  for (const [index, event] of events.entries()) {
    const path = rewrite(event.path)
    if (path === event.path) {
      rewritten?.push(event)
      continue
    }
    rewritten ??= events.slice(0, index)
    rewritten.push({ ...event, path })
  }
  return rewritten ?? events
}
