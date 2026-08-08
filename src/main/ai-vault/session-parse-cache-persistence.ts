// Persists the reusable portion of the AI Vault session parse cache to one
// JSON file under userData so a fresh launch reuses prior parse work instead
// of re-reading the whole transcript corpus (issue #9210: 6.7 GB / 109 s cold
// scans). Disabled unless the composition root calls init; every failure mode
// degrades to today's cold-scan behavior.
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { aiVaultSessionSchema } from './session-list-result-validation'
import {
  seedSessionParseCache,
  snapshotSessionParseCacheForPersistence,
  type PersistedSessionParseCacheEntry,
  type SessionParseStats
} from './session-scanner-parse-cache'

// Bump when the persisted entry layout changes; a mismatched file is discarded whole.
const SCHEMA_VERSION = 1
/**
 * Bump whenever a change alters the `AiVaultSession` emitted for an unchanged
 * transcript. Replaces an `appVersion` equality check that cost hourly-build
 * users a cold scan per update; a mismatch discards the file whole.
 *
 * This docblock, not the per-module headers, is the authority: the producing
 * closure runs well past `session-scanner-*-parser.ts` — the accumulator, the
 * `session-scanner-values` family, the subagent counters, and `src/shared`
 * (`resumeCommand`, `lastUserPrompt`, the fallback title label). Candidate-
 * derived fields (`codexHome`, `agent`) count too; the reuse path returns the
 * cached session untouched. Shape changes are caught by the schema check in
 * `parsePersistedEntry`; same-shape value changes rely only on this constant.
 */
const PARSER_REVISION = 1
// Debounce so back-to-back scans (desktop IPC + runtime RPC) collapse into one write.
const SAVE_DEBOUNCE_MS = 1_500
// The payload contains transcript-derived preview text; keep it user-only
// (mode bits are inert on Windows — the userData ACL grant is the boundary there).
const PRIVATE_DIRECTORY_MODE = 0o700
const PRIVATE_FILE_MODE = 0o600

type SessionParseCachePersistenceOptions = {
  filePath: string
}

let options: SessionParseCachePersistenceOptions | null = null
let loadPromise: Promise<void> | null = null
let saveTimer: NodeJS.Timeout | null = null
let lastSave: Promise<void> = Promise.resolve()

/** Enable persistence. Called only from the composition root; every export is a no-op until then. */
export function initSessionParseCachePersistence(next: SessionParseCachePersistenceOptions): void {
  options = next
}

export function resetSessionParseCachePersistenceForTests(): void {
  options = null
  loadPromise = null
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  lastSave = Promise.resolve()
}

/**
 * Seed the in-memory parse cache from disk. Memoized: concurrent scans at
 * startup all await the same load. Resolves immediately when uninitialized.
 */
export function ensureSessionParseCacheLoaded(): Promise<void> {
  if (options === null) {
    return Promise.resolve()
  }
  loadPromise ??= loadPersistedEntries(options)
  return loadPromise
}

/**
 * Schedule a debounced snapshot write after a scan that parsed something.
 * Reused-only scans schedule no write (the file already reflects the cache).
 */
export function scheduleSessionParseCachePersist(stats: SessionParseStats): void {
  if (options === null || stats.incremental + stats.fullParses <= 0) {
    return
  }
  const current = options
  if (saveTimer) {
    clearTimeout(saveTimer)
  }
  saveTimer = setTimeout(() => {
    saveTimer = null
    // Chained so a slow write and a rescheduled save can't rename out of order
    // (an older snapshot landing last); persistSnapshot never rejects.
    lastSave = lastSave.then(() => persistSnapshot(current))
  }, SAVE_DEBOUNCE_MS)
  // Why: a pending cache save must not keep a quitting process alive.
  if (typeof saveTimer.unref === 'function') {
    saveTimer.unref()
  }
}

/** Run any pending debounced save immediately and wait for it. Test-only. */
export async function flushSessionParseCachePersistForTests(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
    if (options !== null) {
      const current = options
      lastSave = lastSave.then(() => persistSnapshot(current))
    }
  }
  await lastSave
}

async function loadPersistedEntries(current: SessionParseCachePersistenceOptions): Promise<void> {
  await sweepOrphanedTempFiles(current.filePath)
  try {
    const raw = await readFile(current.filePath, 'utf-8')
    const entries = parsePersistedFile(JSON.parse(raw))
    if (entries) {
      seedSessionParseCache(entries)
    }
  } catch {
    // Why: a missing/corrupt/foreign cache file must never fail the scan;
    // worst case is exactly today's cold scan.
  }
}

// A death between temp-write and rename orphans a uniquely named .tmp forever;
// sweep once per launch so they can't accumulate. Racing another instance's
// in-flight save at worst loses that save — the already-accepted rename trade.
async function sweepOrphanedTempFiles(filePath: string): Promise<void> {
  const directory = dirname(filePath)
  try {
    const names = await readdir(directory)
    await Promise.all(
      names
        .filter((name) => name.startsWith('session-parse-cache-') && name.endsWith('.tmp'))
        .map((name) => rm(join(directory, name), { force: true }).catch(() => {}))
    )
  } catch {
    // Directory missing or unreadable — nothing to sweep.
  }
}

// A structurally sound entry whose session no longer matches the current
// `AiVaultSession` shape: drop just this one (it becomes a cold parse) rather
// than the whole file, since the rest of the snapshot is still usable.
const SKIP_ENTRY = Symbol('skip-persisted-entry')

function parsePersistedFile(parsed: unknown): [string, PersistedSessionParseCacheEntry][] | null {
  if (typeof parsed !== 'object' || parsed === null) {
    return null
  }
  const file = parsed as Record<string, unknown>
  // SCHEMA_VERSION guards the file layout, PARSER_REVISION the cached parser
  // output; either mismatching (including a pre-revision file, which has no
  // `parserRevision`) discards the file whole.
  if (file.schemaVersion !== SCHEMA_VERSION || file.parserRevision !== PARSER_REVISION) {
    return null
  }
  if (!Array.isArray(file.entries)) {
    return null
  }
  const entries: [string, PersistedSessionParseCacheEntry][] = []
  for (const item of file.entries) {
    const entry = parsePersistedEntry(item)
    if (entry === null) {
      // One malformed entry means the file can't be trusted; discard it whole.
      return null
    }
    if (entry === SKIP_ENTRY) {
      continue
    }
    entries.push(entry)
  }
  return entries
}

function parsePersistedEntry(
  item: unknown
): [string, PersistedSessionParseCacheEntry] | typeof SKIP_ENTRY | null {
  if (!Array.isArray(item) || item.length !== 2) {
    return null
  }
  const [path, value] = item as [unknown, unknown]
  if (typeof path !== 'string' || typeof value !== 'object' || value === null) {
    return null
  }
  const entry = value as Record<string, unknown>
  if (typeof entry.mtimeMs !== 'number') {
    return null
  }
  if (entry.sizeBytes !== null && typeof entry.sizeBytes !== 'number') {
    return null
  }
  if (typeof entry.platform !== 'string') {
    return null
  }
  if (entry.session !== null && typeof entry.session !== 'object') {
    return null
  }
  // Why validate rather than cast: `PARSER_REVISION` is hand-maintained, so a
  // shape change that shipped without a bump would otherwise reach the renderer
  // as `undefined` fields locally, and be dropped wholesale by the client's zod
  // on a serve host. Rejecting here downgrades a forgotten bump to a cold parse.
  if (entry.session !== null && !aiVaultSessionSchema.safeParse(entry.session).success) {
    return SKIP_ENTRY
  }
  return [
    path,
    {
      mtimeMs: entry.mtimeMs,
      sizeBytes: entry.sizeBytes,
      platform: entry.platform as NodeJS.Platform,
      session: entry.session as PersistedSessionParseCacheEntry['session']
    }
  ]
}

async function persistSnapshot(current: SessionParseCachePersistenceOptions): Promise<void> {
  const directory = dirname(current.filePath)
  const tempPath = join(directory, `session-parse-cache-${process.pid}-${Date.now()}.tmp`)
  try {
    const payload = JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      parserRevision: PARSER_REVISION,
      entries: snapshotSessionParseCacheForPersistence()
    })
    await mkdir(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE })
    await writeFile(tempPath, payload, { mode: PRIVATE_FILE_MODE })
    // Atomic on POSIX; on Windows a rename racing an open handle fails and is
    // caught below (save lost, never a torn file).
    await rename(tempPath, current.filePath)
  } catch (err) {
    // Why: the save runs from a timer — every error must be swallowed here or
    // it becomes an unhandled rejection. Worst case is the no-file case.
    await rm(tempPath, { force: true }).catch(() => {})
    console.debug('[ai-vault] session parse cache save failed', err)
  }
}
