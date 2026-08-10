import { createHash } from 'node:crypto'
import type { Stats } from 'node:fs'
import { lstat, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import type { CursorSidecarScanRequest, CursorSidecarScanResponse } from './cursor-sidecar-scan'
import {
  listLexicographicDirectoryNames,
  safeBasename,
  targetPathVariants
} from './cursor-sidecar-scan-directory'

const BUCKET_PATTERN = /^[0-9a-f]{32}$/u
const BUCKET_READ_CONCURRENCY = 8

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

export type CursorSidecarScanCandidate = Bucket & {
  sessionId: string
  metaPath: string
  meta: Stats
  store: Stats
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
    args.response.counters.rootReaddir++
  } catch (error) {
    if (!isMissing(error)) {
      addIssue(args.response, chatsRoot, error)
    }
    return null
  }
  args.cancellation.throwIfCancelled()

  const direct = await scopeBuckets(args.request, chatsRoot, pathPlatform, args)
  const enumerated = await enumeratedBuckets(chatsRoot, direct, args)
  const sessions = await retainSessions([...direct.values(), ...enumerated], args)
  const candidates = await eligibleCandidates(sessions, args)
  return { rootRealPath, candidates }
}

async function scopeBuckets(
  request: CursorSidecarScanRequest,
  chatsRoot: string,
  pathPlatform: NodeJS.Platform,
  args: {
    caps: CursorSidecarScanCaps
    response: CursorSidecarScanResponse
    cancellation: CursorSidecarScanCancellation
  }
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
    } catch {
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
  args: {
    caps: CursorSidecarScanCaps
    response: CursorSidecarScanResponse
    cancellation: CursorSidecarScanCancellation
  }
): Promise<Bucket[]> {
  try {
    const { names, truncated } = await listLexicographicDirectoryNames({
      dirPath: chatsRoot,
      limit: args.caps.buckets,
      accept: (name, entry) =>
        entry.isDirectory() &&
        !entry.isSymbolicLink() &&
        BUCKET_PATTERN.test(name) &&
        !direct.has(name)
    })
    args.cancellation.throwIfCancelled()
    args.response.truncated.buckets = truncated
    return names.map((name) => ({ name, path: join(chatsRoot, name), scopeCwd: null }))
  } catch (error) {
    if (!isMissing(error)) {
      addIssue(args.response, chatsRoot, error)
    }
    return []
  }
}

async function retainSessions(
  buckets: readonly Bucket[],
  args: {
    caps: CursorSidecarScanCaps
    response: CursorSidecarScanResponse
    cancellation: CursorSidecarScanCancellation
  }
): Promise<(Bucket & { sessionId: string })[]> {
  const retained: (Bucket & { sessionId: string })[] = []
  for (
    let index = 0;
    index < buckets.length && retained.length < args.caps.sessions;
    index += BUCKET_READ_CONCURRENCY
  ) {
    const batch = buckets.slice(index, index + BUCKET_READ_CONCURRENCY)
    const listings = await Promise.all(
      batch.map(async (bucket) => {
        try {
          if (bucket.scopeCwd) {
            args.response.counters.fileLstat++
            const stats = await lstat(bucket.path)
            if (!stats.isDirectory() || stats.isSymbolicLink()) {
              return { bucket, names: [] as string[], truncated: false }
            }
          }
          args.response.counters.bucketReaddir++
          const remaining = Math.max(0, args.caps.sessions - retained.length)
          const listed = await listLexicographicDirectoryNames({
            dirPath: bucket.path,
            limit: remaining,
            accept: (name, entry) =>
              entry.isDirectory() && !entry.isSymbolicLink() && safeBasename(name)
          })
          return { bucket, names: listed.names, truncated: listed.truncated }
        } catch (error) {
          if (!isMissing(error)) {
            addIssue(args.response, bucket.path, error)
          }
          return { bucket, names: [] as string[], truncated: false }
        }
      })
    )
    args.cancellation.throwIfCancelled()
    for (const { bucket, names, truncated } of listings) {
      if (retained.length >= args.caps.sessions) {
        args.response.truncated.sessionDirs = true
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

async function eligibleCandidates(
  sessions: readonly (Bucket & { sessionId: string })[],
  args: {
    caps: CursorSidecarScanCaps
    response: CursorSidecarScanResponse
    cancellation: CursorSidecarScanCancellation
  }
): Promise<CursorSidecarScanCandidate[]> {
  const candidates: CursorSidecarScanCandidate[] = []
  let aggregateBytes = 0
  for (let index = 0; index < sessions.length; index += BUCKET_READ_CONCURRENCY) {
    const batch = sessions.slice(index, index + BUCKET_READ_CONCURRENCY)
    const results = await Promise.all(
      batch.map(async (session): Promise<CursorSidecarScanCandidate | null> => {
        const sessionDir = join(session.path, session.sessionId)
        const metaPath = join(sessionDir, 'meta.json')
        try {
          args.response.counters.fileLstat += 2
          const [meta, store] = await Promise.all([
            lstat(metaPath),
            lstat(join(sessionDir, 'store.db'))
          ])
          if (
            !meta.isFile() ||
            meta.isSymbolicLink() ||
            !store.isFile() ||
            store.isSymbolicLink()
          ) {
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
          if (!isMissing(error)) {
            addIssue(args.response, metaPath, error)
          }
          return null
        }
      })
    )
    args.cancellation.throwIfCancelled()
    for (const result of results) {
      if (!result) {
        continue
      }
      if (aggregateBytes + result.meta.size > args.caps.aggregateBytes) {
        args.response.truncated.sidecarBytes = true
        return sortCandidates(candidates)
      }
      aggregateBytes += result.meta.size
      candidates.push(result)
    }
  }
  return sortCandidates(candidates)
}

function sortCandidates(candidates: CursorSidecarScanCandidate[]): CursorSidecarScanCandidate[] {
  return candidates.sort(
    (left, right) =>
      Number(right.scopeCwd !== null) - Number(left.scopeCwd !== null) ||
      Math.max(right.meta.mtimeMs, right.store.mtimeMs) -
        Math.max(left.meta.mtimeMs, left.store.mtimeMs) ||
      `${left.name}\0${left.sessionId}`.localeCompare(`${right.name}\0${right.sessionId}`)
  )
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
