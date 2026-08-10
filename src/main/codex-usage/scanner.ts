/* eslint-disable max-lines -- Why: Codex discovery, incremental parsing, copied-event ownership, and cache reconciliation form one stateful pipeline. */
import { basename, join } from 'node:path'
import { createReadStream, existsSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { getOrcaManagedCodexHomePath, getSystemCodexHomePath } from '../codex/codex-home-paths'
import { getCodexAccountHomeSessionDirectories } from '../codex/codex-account-home-discovery'
import { getLegacyCopiedCodexSessionBridgeScanPreference } from '../codex/codex-session-bridge'
import { createUsageEventAggregation } from '../usage/usage-event-aggregation'
import {
  attributeUsageEvent,
  canonicalizeUsageAttributionWorktrees,
  type UsageAttributionWorktree
} from '../usage/usage-event-attribution'
import { canonicalizeUsagePath } from '../usage/usage-path-comparison'
import { ensureNumber, extractString } from '../usage/usage-record-coercion'
import type { UsageScanWorktreeRef } from '../usage/usage-provider-contract'
import type {
  CodexUsageAttributedEvent,
  CodexUsageDailyAggregate,
  CodexUsageParsedEvent,
  CodexUsagePersistedFile,
  CodexUsageProcessedFile,
  CodexUsageSession
} from './types'

export type CodexUsageWorktreeRef = UsageScanWorktreeRef

type CodexUsageRawRecord = {
  timestamp?: string
  type?: string
  payload?: Record<string, unknown>
}

type CodexUsageRawUsage = {
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
  totalTokens: number
}

type CodexUsageParseContext = {
  sessionId: string
  sessionCwd: string | null
  currentCwd: string | null
  currentModel: string | null
  previousTotals: CodexUsageRawUsage | null
  totalOnlyBaselinePending?: boolean
}

type CodexUsageDeltaResolution =
  | { kind: 'event'; delta: CodexUsageRawUsage; nextTotals: CodexUsageRawUsage | null }
  | { kind: 'baseline'; nextTotals: CodexUsageRawUsage }

const YIELD_EVERY_FILES = 10
const YIELD_EVERY_DISCOVERY_ENTRIES = 100

async function yieldToEventLoop(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve))
}

async function walkJsonlFiles(
  dirPath: string,
  progress: { entriesVisited: number } = { entriesVisited: 0 }
): Promise<string[]> {
  const entries = await readdir(dirPath, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    progress.entriesVisited += 1
    if (progress.entriesVisited % YIELD_EVERY_DISCOVERY_ENTRIES === 0) {
      await yieldToEventLoop()
    }
    const fullPath = join(dirPath, entry.name)
    if (entry.isDirectory()) {
      appendDiscoveredFiles(files, await walkJsonlFiles(fullPath, progress))
      continue
    }
    if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      files.push(fullPath)
    }
  }

  return files
}

function appendDiscoveredFiles(target: string[], source: readonly string[]): void {
  // Why: large session directories can exceed V8's argument limit if child
  // file arrays are spread into push().
  for (const filePath of source) {
    target.push(filePath)
  }
}

export function getCodexSessionsDirectory(): string {
  // Why: Orca-launched Codex processes receive an Orca-owned CODEX_HOME, so
  // callers that need the primary runtime path should not consult ambient
  // shell CODEX_HOME.
  return join(getOrcaManagedCodexHomePath(), 'sessions')
}

export function getCodexSessionDirectories(): string[] {
  // Why: sessions now live in three lanes — the shared runtime mirror, the real
  // ~/.codex, and per-account self-contained homes; missing any lane silently
  // undercounts usage for multi-account users.
  return [
    getCodexSessionsDirectory(),
    join(getSystemCodexHomePath(), 'sessions'),
    ...getCodexAccountHomeSessionDirectories()
  ].filter((dirPath, index, allDirPaths) => allDirPaths.indexOf(dirPath) === index)
}

function hasLegacyCopiedSessionBridgeMarkers(): boolean {
  return existsSync(join(getOrcaManagedCodexHomePath(), '.orca-session-copies'))
}

export async function listCodexSessionFiles(): Promise<string[]> {
  const files: string[] = []
  for (const dirPath of getCodexSessionDirectories()) {
    try {
      appendDiscoveredFiles(files, await walkJsonlFiles(dirPath))
    } catch {
      // Missing or unreadable history in one home should not hide the other.
    }
  }
  return dedupeCodexSessionFileAliases(files, hasLegacyCopiedSessionBridgeMarkers())
}

async function dedupeCodexSessionFileAliases(
  files: string[],
  hasLegacyBridgeMarkers: boolean
): Promise<string[]> {
  const excludedAliases = new Set<string>()
  if (hasLegacyBridgeMarkers) {
    for (const [index, filePath] of files.entries()) {
      const legacyCopyBridge = getLegacyCopiedCodexSessionBridgeScanPreference(filePath)
      if ((index + 1) % YIELD_EVERY_DISCOVERY_ENTRIES === 0) {
        await yieldToEventLoop()
      }
      if (!legacyCopyBridge) {
        continue
      }
      if (legacyCopyBridge.sourceSkipBytes !== null) {
        continue
      }
      excludedAliases.add(
        await getPhysicalFileAliasKey(
          legacyCopyBridge.preferManagedCopy ? legacyCopyBridge.sourcePath : filePath
        )
      )
    }
  }

  const seenAliases = new Set<string>()
  const uniqueFiles: string[] = []
  for (const [index, filePath] of [...new Set(files)].sort().entries()) {
    const aliasKey = await getCodexSessionFileAliasKey(filePath)
    if (excludedAliases.has(aliasKey)) {
      continue
    }
    if (seenAliases.has(aliasKey)) {
      continue
    }
    seenAliases.add(aliasKey)
    uniqueFiles.push(filePath)
    if ((index + 1) % YIELD_EVERY_DISCOVERY_ENTRIES === 0) {
      await yieldToEventLoop()
    }
  }
  return uniqueFiles
}

async function getCodexSessionFileAliasKey(filePath: string): Promise<string> {
  return getPhysicalFileAliasKey(filePath)
}

async function getPhysicalFileAliasKey(filePath: string): Promise<string> {
  try {
    const fileStat = await stat(filePath)
    if (fileStat.ino !== 0) {
      return `${fileStat.dev}:${fileStat.ino}`
    }
  } catch {}
  return `path:${await canonicalizeUsagePath(filePath)}`
}

function getLegacySourceSkipBytesByPath(
  files: string[],
  hasLegacyBridgeMarkers = hasLegacyCopiedSessionBridgeMarkers()
): Map<string, number> {
  const sourceSkipBytesByPath = new Map<string, number>()
  if (!hasLegacyBridgeMarkers) {
    return sourceSkipBytesByPath
  }
  for (const filePath of files) {
    const legacyCopyBridge = getLegacyCopiedCodexSessionBridgeScanPreference(filePath)
    if (!legacyCopyBridge || legacyCopyBridge.sourceSkipBytes === null) {
      continue
    }
    const existing = sourceSkipBytesByPath.get(legacyCopyBridge.sourcePath) ?? 0
    sourceSkipBytesByPath.set(
      legacyCopyBridge.sourcePath,
      Math.max(existing, legacyCopyBridge.sourceSkipBytes)
    )
  }
  return sourceSkipBytesByPath
}

export async function getProcessedFileInfo(filePath: string): Promise<CodexUsageProcessedFile> {
  const fileStat = await stat(filePath)
  return {
    path: filePath,
    mtimeMs: fileStat.mtimeMs,
    size: fileStat.size
  }
}

function normalizeRawUsage(value: unknown): CodexUsageRawUsage | null {
  if (value == null || typeof value !== 'object') {
    return null
  }

  const record = value as Record<string, unknown>
  const inputTokens = ensureNumber(record.input_tokens)
  const cachedInputTokens = ensureNumber(
    record.cached_input_tokens ?? record.cache_read_input_tokens
  )
  const outputTokens = ensureNumber(record.output_tokens)
  const reasoningOutputTokens = ensureNumber(record.reasoning_output_tokens)
  const totalTokens = ensureNumber(record.total_tokens)

  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens,
    // Why: legacy Codex logs can omit total_tokens. Reasoning is already billed
    // inside output, so synthesizing input+output matches Codex pricing instead
    // of double-counting reasoning as another billable bucket.
    totalTokens: totalTokens > 0 ? totalTokens : inputTokens + outputTokens
  }
}

function subtractRawUsage(
  current: CodexUsageRawUsage,
  previous: CodexUsageRawUsage | null
): CodexUsageRawUsage {
  return {
    inputTokens: Math.max(current.inputTokens - (previous?.inputTokens ?? 0), 0),
    cachedInputTokens: Math.max(current.cachedInputTokens - (previous?.cachedInputTokens ?? 0), 0),
    outputTokens: Math.max(current.outputTokens - (previous?.outputTokens ?? 0), 0),
    reasoningOutputTokens: Math.max(
      current.reasoningOutputTokens - (previous?.reasoningOutputTokens ?? 0),
      0
    ),
    totalTokens: Math.max(current.totalTokens - (previous?.totalTokens ?? 0), 0)
  }
}

function addRawUsage(left: CodexUsageRawUsage, right: CodexUsageRawUsage): CodexUsageRawUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    reasoningOutputTokens: left.reasoningOutputTokens + right.reasoningOutputTokens,
    totalTokens: left.totalTokens + right.totalTokens
  }
}

function rawUsageEquals(left: CodexUsageRawUsage, right: CodexUsageRawUsage): boolean {
  return (
    left.inputTokens === right.inputTokens &&
    left.cachedInputTokens === right.cachedInputTokens &&
    left.outputTokens === right.outputTokens &&
    left.reasoningOutputTokens === right.reasoningOutputTokens
  )
}

function rawUsageIsMonotonic(current: CodexUsageRawUsage, previous: CodexUsageRawUsage): boolean {
  return (
    current.inputTokens >= previous.inputTokens &&
    current.cachedInputTokens >= previous.cachedInputTokens &&
    current.outputTokens >= previous.outputTokens &&
    current.reasoningOutputTokens >= previous.reasoningOutputTokens
  )
}

function rawUsageMagnitude(usage: CodexUsageRawUsage): number {
  return (
    usage.inputTokens + usage.cachedInputTokens + usage.outputTokens + usage.reasoningOutputTokens
  )
}

function looksLikeStaleRegression(
  current: CodexUsageRawUsage,
  previous: CodexUsageRawUsage,
  last: CodexUsageRawUsage
): boolean {
  const previousTotal = rawUsageMagnitude(previous)
  const currentTotal = rawUsageMagnitude(current)
  const lastTotal = rawUsageMagnitude(last)
  if (previousTotal <= 0 || currentTotal <= 0 || lastTotal <= 0) {
    return false
  }
  return currentTotal * 100 >= previousTotal * 98 || currentTotal + lastTotal * 2 >= previousTotal
}

function resolveCodexUsageDelta(
  totalUsage: CodexUsageRawUsage | null,
  lastUsage: CodexUsageRawUsage | null,
  previousTotals: CodexUsageRawUsage | null
): CodexUsageDeltaResolution | null {
  if (totalUsage && lastUsage && previousTotals) {
    if (rawUsageEquals(totalUsage, previousTotals)) {
      return null
    }
    if (
      !rawUsageIsMonotonic(totalUsage, previousTotals) &&
      looksLikeStaleRegression(totalUsage, previousTotals, lastUsage)
    ) {
      return null
    }
    // Why: Codex totals are mutable snapshots after compaction/resume. The
    // last_token_usage payload is the billable increment; totals are the baseline.
    return { kind: 'event', delta: lastUsage, nextTotals: totalUsage }
  }

  if (totalUsage && lastUsage) {
    return { kind: 'event', delta: lastUsage, nextTotals: totalUsage }
  }

  if (totalUsage && previousTotals) {
    if (rawUsageEquals(totalUsage, previousTotals)) {
      return null
    }
    if (!rawUsageIsMonotonic(totalUsage, previousTotals)) {
      return { kind: 'baseline', nextTotals: totalUsage }
    }
    return {
      kind: 'event',
      delta: subtractRawUsage(totalUsage, previousTotals),
      nextTotals: totalUsage
    }
  }

  if (totalUsage) {
    return { kind: 'event', delta: totalUsage, nextTotals: totalUsage }
  }

  if (lastUsage && previousTotals) {
    return { kind: 'event', delta: lastUsage, nextTotals: addRawUsage(previousTotals, lastUsage) }
  }

  if (lastUsage) {
    return { kind: 'event', delta: lastUsage, nextTotals: null }
  }

  return null
}

function buildCodexUsageEventKey(
  timestamp: string,
  totalUsage: CodexUsageRawUsage | null,
  lastUsage: CodexUsageRawUsage | null
): string {
  // Why: fork/resume copies token_count records byte-for-byte into a new
  // rollout file, but session_meta.id is often rewritten to the new session.
  // Key only on the raw record fields (timestamp + usage tuples) so the copy
  // matches the original regardless of surrounding parse context / session id.
  const tupleOf = (usage: CodexUsageRawUsage | null): string =>
    usage
      ? [
          usage.inputTokens,
          usage.cachedInputTokens,
          usage.outputTokens,
          usage.reasoningOutputTokens,
          usage.totalTokens
        ].join(',')
      : ''
  return [timestamp, tupleOf(totalUsage), tupleOf(lastUsage)].join('|')
}

function extractModel(value: unknown): string | null {
  if (value == null || typeof value !== 'object') {
    return null
  }

  const record = value as Record<string, unknown>
  const direct = [extractString(record.model), extractString(record.model_name)].find(
    (candidate) => candidate !== null
  )
  if (direct) {
    return direct
  }

  if (record.info && typeof record.info === 'object') {
    const info = record.info as Record<string, unknown>
    const infoDirect = [extractString(info.model), extractString(info.model_name)].find(
      (candidate) => candidate !== null
    )
    if (infoDirect) {
      return infoDirect
    }
    if (info.metadata && typeof info.metadata === 'object') {
      const metadata = info.metadata as Record<string, unknown>
      const metadataModel = extractString(metadata.model)
      if (metadataModel) {
        return metadataModel
      }
    }
  }

  if (record.metadata && typeof record.metadata === 'object') {
    const metadata = record.metadata as Record<string, unknown>
    return extractString(metadata.model)
  }

  return null
}

type CodexUsageMetric = { hasInferredPricing: boolean }

const codexUsageAggregation = createUsageEventAggregation<
  CodexUsageAttributedEvent,
  CodexUsageMetric
>({
  metric: {
    empty: () => ({ hasInferredPricing: false }),
    fromEvent: (event) => ({ hasInferredPricing: event.hasInferredPricing }),
    fold: (target, source) => {
      target.hasInferredPricing ||= source.hasInferredPricing
    }
  },
  cloneSessionForMerge: (session) => ({
    ...session,
    locationBreakdown: session.locationBreakdown.map((entry) => ({ ...entry })),
    modelBreakdown: session.modelBreakdown.map((entry) => ({ ...entry })),
    locationModelBreakdown: session.locationModelBreakdown.map((entry) => ({ ...entry }))
  })
})

const { finalizeSessions, mergeSessions, mergeDailyAggregates, sortDailyAggregates } =
  codexUsageAggregation

export function parseCodexUsageRecord(
  line: string,
  context: CodexUsageParseContext
): CodexUsageParsedEvent | null {
  let parsed: CodexUsageRawRecord
  try {
    parsed = JSON.parse(line) as CodexUsageRawRecord
  } catch {
    return null
  }

  if (!parsed.type || !parsed.payload) {
    return null
  }

  if (parsed.type === 'session_meta') {
    context.sessionId = extractString(parsed.payload.id) ?? context.sessionId
    context.sessionCwd = extractString(parsed.payload.cwd)
    if (!context.currentCwd && context.sessionCwd) {
      context.currentCwd = context.sessionCwd
    }
    return null
  }

  if (parsed.type === 'turn_context') {
    context.currentCwd =
      extractString(parsed.payload.cwd) ?? context.currentCwd ?? context.sessionCwd
    context.currentModel = extractModel(parsed.payload) ?? context.currentModel
    return null
  }

  if (parsed.type !== 'event_msg' || parsed.payload.type !== 'token_count' || !parsed.timestamp) {
    return null
  }

  const info = parsed.payload.info
  if (info == null || typeof info !== 'object') {
    // Why: Codex emits token_count snapshots with null info for rate-limit
    // updates. Treating them as malformed usage would make active sessions look
    // flaky and create false scan errors for perfectly valid logs.
    return null
  }

  const record = info as Record<string, unknown>
  const totalUsage = normalizeRawUsage(record.total_token_usage)
  const lastUsage = normalizeRawUsage(record.last_token_usage)
  if (context.totalOnlyBaselinePending) {
    context.totalOnlyBaselinePending = false
    if (totalUsage && !lastUsage && !context.previousTotals) {
      context.previousTotals = totalUsage
      return null
    }
  }
  const resolvedUsage = resolveCodexUsageDelta(totalUsage, lastUsage, context.previousTotals)
  if (!resolvedUsage) {
    return null
  }
  if (resolvedUsage.kind === 'baseline') {
    context.previousTotals = resolvedUsage.nextTotals
    return null
  }

  let delta = {
    ...resolvedUsage.delta,
    cachedInputTokens: Math.min(
      resolvedUsage.delta.cachedInputTokens,
      resolvedUsage.delta.inputTokens
    )
  }

  if (
    delta.inputTokens === 0 &&
    delta.cachedInputTokens === 0 &&
    delta.outputTokens === 0 &&
    delta.reasoningOutputTokens === 0 &&
    delta.totalTokens === 0
  ) {
    return null
  }

  context.previousTotals = resolvedUsage.nextTotals

  const resolvedModel = extractModel(parsed.payload) ?? context.currentModel
  const hasInferredPricing = resolvedModel === null

  return {
    sessionId: context.sessionId,
    timestamp: parsed.timestamp,
    eventKey: buildCodexUsageEventKey(parsed.timestamp, totalUsage, lastUsage),
    cwd: context.currentCwd ?? context.sessionCwd,
    model: resolvedModel,
    hasInferredPricing,
    inputTokens: delta.inputTokens,
    cachedInputTokens: delta.cachedInputTokens,
    outputTokens: delta.outputTokens,
    reasoningOutputTokens: delta.reasoningOutputTokens,
    totalTokens: delta.totalTokens
  }
}

export async function parseCodexUsageFile(
  filePath: string,
  worktrees: UsageAttributionWorktree[],
  options: { skipInitialBytes?: number; claimEventKey?: (eventKey: string) => boolean } = {}
): Promise<CodexUsagePersistedFile> {
  const processedFile = await getProcessedFileInfo(filePath)
  const lines = createInterface({
    input: createReadStream(filePath, {
      encoding: 'utf-8',
      start: options.skipInitialBytes ?? 0
    }),
    crlfDelay: Infinity
  })
  const events: CodexUsageAttributedEvent[] = []
  const context: CodexUsageParseContext = {
    sessionId: basename(filePath, '.jsonl'),
    sessionCwd: null,
    currentCwd: null,
    currentModel: null,
    previousTotals: null,
    // Why: suffix-only legacy copy parsing lacks the copied prefix context. A
    // leading total-only snapshot is a baseline, not the suffix's billable delta.
    totalOnlyBaselinePending: (options.skipInitialBytes ?? 0) > 0
  }

  const ownedEventKeys = new Set<string>()
  let hasDeferredClaims = false
  for await (const line of lines) {
    const parsed = parseCodexUsageRecord(line, context)
    if (!parsed) {
      continue
    }
    // Why: fork/resume rollouts start with a copied prefix of the parent file.
    // Events another file already owns are dropped here, but the record still
    // advanced context.previousTotals above, so later deltas stay correct.
    if (options.claimEventKey && !options.claimEventKey(parsed.eventKey)) {
      hasDeferredClaims = true
      continue
    }
    ownedEventKeys.add(parsed.eventKey)
    const attributed = attributeUsageEvent(parsed, worktrees)
    if (attributed) {
      events.push(attributed)
    }
  }

  return {
    ...processedFile,
    ...codexUsageAggregation.aggregate(events),
    ownedEventKeys: [...ownedEventKeys],
    hasDeferredClaims
  }
}

export async function scanCodexUsageFiles(
  worktrees: CodexUsageWorktreeRef[],
  previousProcessedFiles: CodexUsagePersistedFile[]
): Promise<{
  processedFiles: CodexUsagePersistedFile[]
  sessions: CodexUsageSession[]
  dailyAggregates: CodexUsageDailyAggregate[]
}> {
  const files = await listCodexSessionFiles()
  const previousByPath = new Map(previousProcessedFiles.map((file) => [file.path, file]))
  const worktreesWithCanonicalPaths = await canonicalizeUsageAttributionWorktrees(worktrees)
  const legacySourceSkipBytesByPath = getLegacySourceSkipBytesByPath(files)

  const currentPaths = new Set(files)
  // Why: when a rollout that owned event keys is deleted, remaining forks still
  // contain those records but their caches record them as unowned. Only files
  // that previously deferred claims can reclaim, so invalidate those — not the
  // entire rollout corpus.
  const lostOwnerPath = previousProcessedFiles.some(
    (file) =>
      !currentPaths.has(file.path) &&
      Array.isArray(file.ownedEventKeys) &&
      file.ownedEventKeys.length > 0
  )

  const reusedByPath = new Map<string, CodexUsagePersistedFile>()
  const pathsToParse: string[] = []
  for (const [index, filePath] of files.entries()) {
    const legacySourceSkipBytes = legacySourceSkipBytesByPath.get(filePath) ?? 0
    const fileInfo = await getProcessedFileInfo(filePath)
    const previous = previousByPath.get(filePath)
    // When an owner disappears, only deferred-claim files need reparse.
    const mustReclaimDeferred = lostOwnerPath && previous?.hasDeferredClaims !== false
    const canReuse =
      !mustReclaimDeferred &&
      legacySourceSkipBytes === 0 &&
      previous &&
      previous.mtimeMs === fileInfo.mtimeMs &&
      previous.size === fileInfo.size &&
      Array.isArray(previous.ownedEventKeys) &&
      typeof previous.hasDeferredClaims === 'boolean'
    if (canReuse) {
      reusedByPath.set(filePath, previous)
    } else {
      pathsToParse.push(filePath)
    }
    if ((index + 1) % YIELD_EVERY_FILES === 0) {
      await yieldToEventLoop()
    }
  }

  // Why: resuming or forking a Codex session copies the parent rollout's
  // token_count records into a new file, so per-file parsing re-counts the
  // whole copied history once per descendant (#8006). Cross-file ownership
  // counts each record for exactly one file; cached files keep the claims
  // they persisted, and new files claim in sorted-path order so rescans stay
  // deterministic.
  const eventOwnerByKey = new Map<string, string>()
  for (const [filePath, previous] of reusedByPath) {
    for (const eventKey of previous.ownedEventKeys) {
      // First cached claim wins so conflicting projections stay deterministic.
      if (!eventOwnerByKey.has(eventKey)) {
        eventOwnerByKey.set(eventKey, filePath)
      }
    }
  }

  const parsedByPath = new Map<string, CodexUsagePersistedFile>()
  for (const [index, filePath] of pathsToParse.entries()) {
    const processed = await parseCodexUsageFile(filePath, worktreesWithCanonicalPaths, {
      skipInitialBytes: legacySourceSkipBytesByPath.get(filePath) ?? 0,
      claimEventKey: (eventKey) => {
        const owner = eventOwnerByKey.get(eventKey)
        if (owner !== undefined && owner !== filePath) {
          return false
        }
        eventOwnerByKey.set(eventKey, filePath)
        return true
      }
    })
    parsedByPath.set(filePath, processed)

    // Why: Codex session history can grow large, and scans run on the Electron
    // main process. Yield regularly so opening Settings does not stall while
    // a background refresh walks old JSONL files.
    if ((index + 1) % YIELD_EVERY_FILES === 0) {
      await yieldToEventLoop()
    }
  }

  const processedFiles: CodexUsagePersistedFile[] = []
  const sessionsById = new Map<string, CodexUsageSession>()
  const dailyByKey = new Map<string, CodexUsageDailyAggregate>()
  for (const filePath of files) {
    const processed = reusedByPath.get(filePath) ?? parsedByPath.get(filePath)
    if (!processed) {
      continue
    }
    processedFiles.push(processed)
    mergeSessions(sessionsById, processed.sessions)
    mergeDailyAggregates(dailyByKey, processed.dailyAggregates)
  }

  return {
    processedFiles,
    sessions: finalizeSessions(sessionsById),
    dailyAggregates: sortDailyAggregates(dailyByKey)
  }
}
