import { createHash } from 'node:crypto'
import type { Stats } from 'node:fs'
import { lstat, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import type { CursorSidecarScanRequest, CursorSidecarScanResponse } from './cursor-sidecar-scan'
import {
  CURSOR_DIR_MAX_ENTRIES_EXAMINED,
  listLexicographicDirectoryNames,
  safeBasename,
  targetPathVariants
} from './cursor-sidecar-scan-directory'

const BUCKET_PATTERN = /^[0-9a-f]{32}$/u
const BUCKET_READ_CONCURRENCY = 8
/** Check cancellation every N dirents during cold directory walks. */
const CANCEL_CHECK_EVERY_DIRENTS = 64

export type CursorSidecarScanCaps = {
  buckets: number
  sessions: number
  scopes: number
  sidecarBytes: number
  aggregateBytes: number
}

export type CursorSidecarScanCancellation = {
  throwIfCancelled: () => void
}

type Bucket = { name: string; path: string; scopeCwd: string | null }
type ScanArgs = {
  caps: CursorSidecarScanCaps
  response: CursorSidecarScanResponse
  cancellation: CursorSidecarScanCancellation
}

export type CursorSidecarScanCandidate = Bucket & {
  sessionId: string
  metaPath: string
  meta: Stats
  store: Stats
}

export function isCursorSidecarScanCancelledError(error: unknown): boolean {
  return error instanceof Error && error.message === 'cursor_sidecar_scan_cancelled'
}

export function cursorSidecarScanCancellationFromSignal(
  signal?: AbortSignal
): CursorSidecarScanCancellation {
  return {
    throwIfCancelled: () => {
      if (signal?.aborted) {
        throw new Error('cursor_sidecar_scan_cancelled')
      }
    }
  }
}

export async function discoverCursorSidecarCandidates(args: {
  request: CursorSidecarScanRequest
  caps: CursorSidecarScanCaps
  response: CursorSidecarScanResponse
  cancellation: CursorSidecarScanCancellation
  // Why: WSL scopes are Linux paths after UNC conversion while process.platform
  // remains win32; path flavor must follow the storage context, not the host OS.
  pathPlatform?: NodeJS.Platform
}): Promise<{ rootRealPath: string; candidates: CursorSidecarScanCandidate[] } | null> {
  const pathPlatform = args.pathPlatform ?? process.platform
  const chatsRoot = args.request.chatsRoot
  let rootRealPath: string
  try {
    rootRealPath = await realpath(chatsRoot)
  } catch (error) {
    rethrowCancel(error)
    if (!isMissing(error)) {
      addIssue(args.response, chatsRoot, error)
    }
    return null
  }
  // First enumeration-phase cancel check (after root resolve, before walks).
  args.cancellation.throwIfCancelled()

  const direct = await scopeBuckets(args.request, chatsRoot, pathPlatform, args)
  const enumerated = await enumeratedBuckets(chatsRoot, direct, args)
  const sessions = await retainSessions([...direct.values(), ...enumerated], args)
  return { rootRealPath, candidates: await eligibleCandidates(sessions, args) }
}

async function scopeBuckets(
  request: CursorSidecarScanRequest,
  chatsRoot: string,
  pathPlatform: NodeJS.Platform,
  args: ScanArgs
): Promise<Map<string, Bucket>> {
  // Truncation is measured on the full unique list before the cap slice.
  const paths = [...new Set(request.scopePaths.map((value) => value.trim()).filter(Boolean))].sort()
  args.response.truncated.scopePaths = paths.length > args.caps.scopes
  const cwds = new Set<string>()
  for (const scopePath of paths.slice(0, args.caps.scopes)) {
    for (const cwd of targetPathVariants(scopePath, pathPlatform)) {
      cwds.add(cwd)
    }
    try {
      args.response.counters.scopeRealpath++
      const resolved = await realpath(scopePath)
      for (const cwd of targetPathVariants(resolved, pathPlatform)) {
        cwds.add(cwd)
      }
    } catch (error) {
      rethrowCancel(error)
      // Scope paths are allowed to be absent on the owning host.
    }
    args.cancellation.throwIfCancelled()
  }
  const buckets = new Map<string, Bucket>()
  args.response.scopeCwds = [...cwds].sort()
  for (const cwd of args.response.scopeCwds) {
    // Cursor names its bucket dirs md5(cwd); this mirrors that, not a security primitive.
    const name = createHash('md5').update(cwd).digest('hex')
    buckets.set(name, { name, path: join(chatsRoot, name), scopeCwd: cwd })
  }
  return buckets
}

async function enumeratedBuckets(
  chatsRoot: string,
  direct: ReadonlyMap<string, Bucket>,
  args: ScanArgs
): Promise<Bucket[]> {
  // Cancel check must sit outside the listing try so it is never turned into an issue.
  args.cancellation.throwIfCancelled()
  try {
    args.response.counters.rootReaddir++
    const { names, truncated } = await listLexicographicDirectoryNames({
      dirPath: chatsRoot,
      limit: args.caps.buckets,
      maxEntriesExamined: CURSOR_DIR_MAX_ENTRIES_EXAMINED,
      accept: (name, entry) =>
        entry.isDirectory() &&
        !entry.isSymbolicLink() &&
        BUCKET_PATTERN.test(name) &&
        !direct.has(name),
      onDirent: createDirentCancelChecker(args.cancellation)
    })
    args.cancellation.throwIfCancelled()
    args.response.truncated.buckets = truncated
    return names.map((name) => ({ name, path: join(chatsRoot, name), scopeCwd: null }))
  } catch (error) {
    rethrowCancel(error)
    if (!isMissing(error)) {
      addIssue(args.response, chatsRoot, error)
    }
    return []
  }
}

async function retainSessions(
  buckets: readonly Bucket[],
  args: ScanArgs
): Promise<(Bucket & { sessionId: string })[]> {
  const retained: (Bucket & { sessionId: string })[] = []
  for (
    let index = 0;
    index < buckets.length && retained.length < args.caps.sessions;
    index += BUCKET_READ_CONCURRENCY
  ) {
    args.cancellation.throwIfCancelled()
    const batch = buckets.slice(index, index + BUCKET_READ_CONCURRENCY)
    const listings = await Promise.all(
      batch.map((bucket) => listBucketSessions(bucket, args, retained.length))
    )
    args.cancellation.throwIfCancelled()
    for (let listingIndex = 0; listingIndex < listings.length; listingIndex += 1) {
      const { bucket, names, truncated } = listings[listingIndex]
      if (retained.length >= args.caps.sessions) {
        if (
          listings.slice(listingIndex).some((listing) => listing.truncated || listing.names.length)
        ) {
          args.response.truncated.sessionDirs = true
        }
        break
      }
      const capacity = args.caps.sessions - retained.length
      retained.push(...names.slice(0, capacity).map((sessionId) => ({ ...bucket, sessionId })))
      if (truncated || names.length > capacity) {
        args.response.truncated.sessionDirs = true
      }
    }
    if (retained.length >= args.caps.sessions && index + batch.length < buckets.length) {
      args.response.truncated.sessionDirs = true
    }
  }
  return retained
}

async function listBucketSessions(
  bucket: Bucket,
  args: ScanArgs,
  retainedCount: number
): Promise<{ bucket: Bucket; names: string[]; truncated: boolean }> {
  try {
    if (bucket.scopeCwd) {
      args.response.counters.fileLstat++
      const stats = await lstat(bucket.path)
      if (!stats.isDirectory() || stats.isSymbolicLink()) {
        return { bucket, names: [], truncated: false }
      }
    }
    args.response.counters.bucketReaddir++
    const listed = await listLexicographicDirectoryNames({
      dirPath: bucket.path,
      limit: Math.max(0, args.caps.sessions - retainedCount),
      maxEntriesExamined: CURSOR_DIR_MAX_ENTRIES_EXAMINED,
      accept: (name, entry) => entry.isDirectory() && !entry.isSymbolicLink() && safeBasename(name),
      onDirent: createDirentCancelChecker(args.cancellation)
    })
    return { bucket, names: listed.names, truncated: listed.truncated }
  } catch (error) {
    rethrowCancel(error)
    if (!isMissing(error)) {
      addIssue(args.response, bucket.path, error)
    }
    return { bucket, names: [], truncated: false }
  }
}

async function eligibleCandidates(
  sessions: readonly (Bucket & { sessionId: string })[],
  args: ScanArgs
): Promise<CursorSidecarScanCandidate[]> {
  // Collect every eligible candidate first, then apply newest-first retention
  // before the aggregate byte budget (stable lexical ties).
  const eligible: CursorSidecarScanCandidate[] = []
  for (let index = 0; index < sessions.length; index += BUCKET_READ_CONCURRENCY) {
    args.cancellation.throwIfCancelled()
    const batch = sessions.slice(index, index + BUCKET_READ_CONCURRENCY)
    const results = await Promise.all(batch.map((session) => inspectSession(session, args)))
    args.cancellation.throwIfCancelled()
    for (const result of results) {
      if (result) {
        eligible.push(result)
      }
    }
  }
  return retainByNewestThenAggregate(eligible, args)
}

async function inspectSession(
  session: Bucket & { sessionId: string },
  args: ScanArgs
): Promise<CursorSidecarScanCandidate | null> {
  const sessionDir = join(session.path, session.sessionId)
  const metaPath = join(sessionDir, 'meta.json')
  try {
    args.response.counters.fileLstat += 2
    const [meta, store] = await Promise.all([lstat(metaPath), lstat(join(sessionDir, 'store.db'))])
    if (!meta.isFile() || meta.isSymbolicLink() || !store.isFile() || store.isSymbolicLink()) {
      return null
    }
    if (meta.size > args.caps.sidecarBytes) {
      addIssue(
        args.response,
        metaPath,
        new Error('Cursor session metadata exceeds the read limit.')
      )
      return null
    }
    return { ...session, metaPath, meta, store }
  } catch (error) {
    rethrowCancel(error)
    if (!isMissing(error)) {
      addIssue(args.response, metaPath, error)
    }
    return null
  }
}

function retainByNewestThenAggregate(
  eligible: CursorSidecarScanCandidate[],
  args: ScanArgs
): CursorSidecarScanCandidate[] {
  const ranked = eligible.sort(
    (left, right) =>
      Number(right.scopeCwd !== null) - Number(left.scopeCwd !== null) ||
      Math.max(right.meta.mtimeMs, right.store.mtimeMs) -
        Math.max(left.meta.mtimeMs, left.store.mtimeMs) ||
      `${left.name}\0${left.sessionId}`.localeCompare(`${right.name}\0${right.sessionId}`)
  )
  const retained: CursorSidecarScanCandidate[] = []
  let aggregateBytes = 0
  for (const candidate of ranked) {
    if (aggregateBytes + candidate.meta.size > args.caps.aggregateBytes) {
      args.response.truncated.sidecarBytes = true
      break
    }
    aggregateBytes += candidate.meta.size
    retained.push(candidate)
  }
  return retained
}

function createDirentCancelChecker(cancellation: CursorSidecarScanCancellation): () => void {
  let seen = 0
  return () => {
    seen += 1
    if (seen % CANCEL_CHECK_EVERY_DIRENTS === 0) {
      cancellation.throwIfCancelled()
    }
  }
}

function rethrowCancel(error: unknown): void {
  if (isCursorSidecarScanCancelledError(error)) {
    throw error
  }
}

function addIssue(response: CursorSidecarScanResponse, path: string, error: unknown): void {
  response.issues.push({
    path,
    message: error instanceof Error ? error.message.slice(0, 1_024) : 'Cursor scan failed.'
  })
}

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code
  return code === 'ENOENT' || code === 'ENOTDIR'
}
