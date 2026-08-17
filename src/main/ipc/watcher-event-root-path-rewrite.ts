/**
 * macOS FSEvents reports OS-canonical paths: symlinks resolved and each
 * directory in its on-disk spelling. A worktree reached through a symlink
 * (`~/code` -> `/Volumes/…`, anything under `/tmp` or `/var`) or opened with
 * different casing on a case-insensitive volume therefore emits events that no
 * longer sit under the root the renderer subscribed with. Every consumer
 * derives a worktree-relative path from that root, so those events are dropped
 * outright — the editor never reloads an agent's edit, the File Explorer never
 * refreshes, and Source Control never re-runs status.
 *
 * Linux (inotify) and Windows both rebuild paths from the requested root, so
 * only macOS observes the mismatch. Rewrite at the watcher boundary anyway so
 * the "event paths live under worktreePath" contract is platform-independent.
 */
import { realpath } from 'node:fs/promises'

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

export async function resolveWatcherEventRootPathRewrite(
  requestedRoot: string,
  deps: {
    realpath?: (candidate: string) => Promise<string>
    platform?: NodeJS.Platform
  } = {}
): Promise<WatcherEventRootPathRewrite> {
  let canonicalRoot = requestedRoot
  try {
    canonicalRoot = await (deps.realpath ?? realpath)(requestedRoot)
  } catch {
    // Why: a vanished or unreadable root still gets a watcher attempt (and its
    // own failure path); fall back to the literal spelling rather than fail
    // here. Resolving the binding inside the try also keeps suites that mock a
    // partial node:fs/promises from turning this into a watcher install failure.
  }
  return createWatcherEventRootPathRewrite(requestedRoot, canonicalRoot, deps.platform)
}

export type RootPathRewritingWatcherCallback<E> = {
  /** Drop-in replacement for the caller's watcher callback. */
  callback: (error: Error | null, events: E[]) => void
  /**
   * Resolves once the rewrite is installed. Await it before settling a
   * subscribe so callers never observe an un-rewritten batch — but only after
   * the subscription itself is recorded, so teardown never waits on a realpath.
   */
  ready: Promise<void>
}

/**
 * Wraps a watcher callback so every delivered event path is spelled the way
 * `dir` was subscribed. Resolution runs alongside the subscribe rather than
 * before it: an await ahead of the subscribe would let an abort land in a gap
 * where no watcher subscription exists to cancel.
 */
export function createRootPathRewritingWatcherCallback<E extends { path: string }>(
  dir: string,
  callback: (error: Error | null, events: E[]) => void
): RootPathRewritingWatcherCallback<E> {
  let rewrite = identityWatcherEventRootPathRewrite
  const ready = resolveWatcherEventRootPathRewrite(dir).then((resolved) => {
    rewrite = resolved
  })
  return {
    callback: (error, events) => callback(error, applyWatcherEventRootPathRewrite(events, rewrite)),
    ready
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
