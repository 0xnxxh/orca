import { isAiVaultScanCancelledError, type AiVaultScanIssue } from '../../shared/ai-vault-types'
import type { ExecutionHostId } from '../../shared/execution-host'
import {
  CURSOR_REMOTE_MAX_AGGREGATE_BYTES,
  CURSOR_SIDECAR_MAX_BYTES
} from '../../shared/cursor-sidecar-scan'
import { isCursorSidecarScanCancelledError } from '../../shared/cursor-sidecar-scan-discovery'
import type { ActiveSpan } from '../observability/tracer'
import { parseAgentSessionFileCached } from './session-scanner-parse-cache'
import type { SessionParseStats } from './session-scanner-parse-cache'
import { recordCursorScanSpan } from './session-scanner-cursor-observability'
import {
  reconcileCursorCandidates,
  type ParsedCursorCandidate
} from './session-scanner-cursor-reconcile'
import { parseCursorSidecarFileCached } from './session-scanner-cursor-sidecar'
import type { SessionFileCandidate, SessionFileDiscovery } from './session-scanner-types'
import { errorMessage } from './session-scanner-values'
import { throwIfAiVaultScanCancelled } from './ai-vault-scan-cancellation'
import {
  buildCursorCandidateSelectionGroups,
  canStopCursorGroupSelection,
  selectCursorScopedGroups,
  type CursorCandidateSelectionGroup
} from './session-scanner-cursor-selection'

const CURSOR_PARSE_CONCURRENCY = 8

export async function processLocalCursorCandidates(args: {
  candidates: readonly SessionFileCandidate[]
  limit: number
  scopeLimit: number
  platform: NodeJS.Platform
  executionHostId: ExecutionHostId
  issues: AiVaultScanIssue[]
  parseStats: SessionParseStats
  span: ActiveSpan
  discoveries?: readonly SessionFileDiscovery[]
  signal?: AbortSignal
}): Promise<ReturnType<typeof reconcileCursorCandidates>> {
  const groups = buildCursorCandidateSelectionGroups({
    candidates: args.candidates,
    platform: args.platform,
    adapter: {
      getCwdEvidence: (candidate) => candidate.cursorCwdEvidence,
      getFile: (candidate) => candidate.file,
      getLayout: (candidate) => candidate.cursorLayout ?? 'legacy',
      getStorageContextKey: (candidate) => candidate.cursorStorageContextKey ?? 'native'
    }
  })
  const verifiedReads = createVerifiedReadTracker(args.discoveries)
  const parsed: ParsedCursorCandidate[] = []
  const processedGroups = new Set<CursorCandidateSelectionGroup<SessionFileCandidate>>()
  for (let index = 0; index < groups.length; index += CURSOR_PARSE_CONCURRENCY) {
    // Reconcile is O(parsed); sessions never outnumber candidates, so a short parsed
    // count can't satisfy the limit and the preview would be wasted work.
    if (parsed.length >= args.limit) {
      const preview = reconcileCursorCandidates({
        candidates: parsed,
        executionHostId: args.executionHostId,
        platform: args.platform,
        issues: []
      })
      if (canStopCursorGroupSelection(preview.sessions, args.limit, groups[index]?.mtimeMs)) {
        break
      }
    }
    const batch = groups.slice(index, index + CURSOR_PARSE_CONCURRENCY)
    await parseCursorGroups(batch, parsed, args, verifiedReads)
    batch.forEach((group) => processedGroups.add(group))
  }
  const scopedGroups = selectCursorScopedGroups(groups, processedGroups, args.scopeLimit)
  for (let index = 0; index < scopedGroups.length; index += CURSOR_PARSE_CONCURRENCY) {
    const batch = scopedGroups.slice(index, index + CURSOR_PARSE_CONCURRENCY)
    await parseCursorGroups(batch, parsed, args, verifiedReads)
  }
  const reconciled = reconcileCursorCandidates({
    candidates: parsed,
    executionHostId: args.executionHostId,
    platform: args.platform,
    issues: args.issues
  })
  recordCursorScanSpan({
    span: args.span,
    sidecarCandidatePaths: args.candidates
      .filter((candidate) => candidate.cursorLayout === 'sidecar')
      .map((candidate) => candidate.file.path),
    parsedCandidates: parsed,
    issues: args.issues,
    reconcileStats: reconciled.stats
  })
  return reconciled
}

type VerifiedReadTracker = {
  byStorageKey: Map<
    string,
    {
      counters: NonNullable<SessionFileDiscovery['cursorDiscoveryCounters']>
      truncated: NonNullable<SessionFileDiscovery['cursorDiscoveryTruncated']>
    }
  >
  budgetsByStorageKey: Map<string, VerifiedReadBudget>
}

type VerifiedReadBudget = { chargedBytes: number; gate: Promise<void> }

function createVerifiedReadTracker(
  discoveries: readonly SessionFileDiscovery[] | undefined
): VerifiedReadTracker {
  const byStorageKey = new Map<
    string,
    {
      counters: NonNullable<SessionFileDiscovery['cursorDiscoveryCounters']>
      truncated: NonNullable<SessionFileDiscovery['cursorDiscoveryTruncated']>
    }
  >()
  for (const discovery of discoveries ?? []) {
    if (
      discovery.agent !== 'cursor' ||
      discovery.cursorLayout !== 'sidecar' ||
      !discovery.cursorDiscoveryCounters ||
      !discovery.cursorDiscoveryTruncated
    ) {
      continue
    }
    byStorageKey.set(discovery.cursorStorageContextKey ?? 'native', {
      counters: discovery.cursorDiscoveryCounters,
      truncated: discovery.cursorDiscoveryTruncated
    })
  }
  return { byStorageKey, budgetsByStorageKey: new Map() }
}

async function withVerifiedReadGate<T>(
  budget: VerifiedReadBudget,
  run: () => Promise<T>
): Promise<T> {
  const previous = budget.gate
  let release!: () => void
  budget.gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await previous
  try {
    return await run()
  } finally {
    release()
  }
}

function verifiedReadBudget(tracker: VerifiedReadTracker, storageKey: string): VerifiedReadBudget {
  const existing = tracker.budgetsByStorageKey.get(storageKey)
  if (existing) {
    return existing
  }
  const created = { chargedBytes: 0, gate: Promise.resolve() }
  tracker.budgetsByStorageKey.set(storageKey, created)
  return created
}

async function parseCursorGroups(
  groups: readonly CursorCandidateSelectionGroup<SessionFileCandidate>[],
  parsed: ParsedCursorCandidate[],
  args: {
    platform: NodeJS.Platform
    executionHostId: ExecutionHostId
    issues: AiVaultScanIssue[]
    parseStats: SessionParseStats
    signal?: AbortSignal
  },
  verifiedReads: VerifiedReadTracker
): Promise<void> {
  const candidates = groups.flatMap((group) => group.candidates)
  for (let index = 0; index < candidates.length; index += CURSOR_PARSE_CONCURRENCY) {
    const batch = candidates.slice(index, index + CURSOR_PARSE_CONCURRENCY)
    const results = await Promise.all(
      batch.map((candidate) => parseCursorCandidate(candidate, args, verifiedReads))
    )
    parsed.push(...results.filter((result): result is ParsedCursorCandidate => Boolean(result)))
  }
}

async function parseCursorCandidate(
  candidate: SessionFileCandidate,
  args: {
    platform: NodeJS.Platform
    executionHostId: ExecutionHostId
    issues: AiVaultScanIssue[]
    parseStats: SessionParseStats
    signal?: AbortSignal
  },
  verifiedReads: VerifiedReadTracker
): Promise<ParsedCursorCandidate | null> {
  const layout = candidate.cursorLayout ?? 'legacy'
  try {
    if (layout === 'sidecar') {
      return await parseSidecarWithAggregateCap(candidate, args, verifiedReads)
    }
    const legacy = await parseAgentSessionFileCached(candidate, args.platform, args.parseStats)
    return legacy
      ? {
          layout,
          storageContextKey: candidate.cursorStorageContextKey ?? 'native',
          file: candidate.file,
          cwdEvidence: candidate.cursorCwdEvidence,
          legacy
        }
      : null
  } catch (error) {
    if (isCursorSidecarScanCancelledError(error) || isAiVaultScanCancelledError(error)) {
      throw error
    }
    args.issues.push({
      executionHostId: args.executionHostId,
      agent: 'cursor',
      path: candidate.file.path,
      message: errorMessage(error)
    })
    return null
  }
}

async function parseSidecarWithAggregateCap(
  candidate: SessionFileCandidate,
  args: {
    platform: NodeJS.Platform
    executionHostId: ExecutionHostId
    issues: AiVaultScanIssue[]
    signal?: AbortSignal
  },
  verifiedReads: VerifiedReadTracker
): Promise<ParsedCursorCandidate | null> {
  const storageKey = candidate.cursorStorageContextKey ?? 'native'
  const storage = verifiedReads.byStorageKey.get(storageKey)
  const budget = verifiedReadBudget(verifiedReads, storageKey)
  // Unknown size reserves the per-sidecar max so concurrent admission cannot overshoot.
  const estimatedBytes =
    candidate.file.sizeBytes === undefined
      ? CURSOR_SIDECAR_MAX_BYTES
      : Math.min(Math.max(0, candidate.file.sizeBytes), CURSOR_SIDECAR_MAX_BYTES)

  // Gate covers reserve → verified read → commit of actual returned bytes.
  return withVerifiedReadGate(budget, async () => {
    throwIfAiVaultScanCancelled(args.signal)
    if (budget.chargedBytes >= CURSOR_REMOTE_MAX_AGGREGATE_BYTES) {
      if (storage) {
        storage.truncated.sidecarBytes = true
      }
      return null
    }
    if (budget.chargedBytes + estimatedBytes > CURSOR_REMOTE_MAX_AGGREGATE_BYTES) {
      if (storage) {
        storage.truncated.sidecarBytes = true
      }
      return null
    }

    let result
    try {
      result = await parseCursorSidecarFileCached({
        file: candidate.file,
        platform: args.platform,
        targetPlatform: candidate.cursorTargetPlatform,
        executionHostId: args.executionHostId,
        expectedRootRealPath: candidate.cursorExpectedRootRealPath
      })
    } catch (error) {
      if (storage) {
        storage.counters.boundedReads += 1
      }
      if (isVerifiedReadTooLargeError(error)) {
        budget.chargedBytes = CURSOR_REMOTE_MAX_AGGREGATE_BYTES
        if (storage) {
          storage.truncated.sidecarBytes = true
        }
      } else {
        // A failed remote read hides how many bytes it consumed; charge its full ceiling.
        budget.chargedBytes += CURSOR_SIDECAR_MAX_BYTES
      }
      throwIfAiVaultScanCancelled(args.signal)
      throw error
    }

    if (!result.cacheHit) {
      const readBytes = result.returnedBytes ?? 0
      if (storage) {
        // Count the logical verified-read work even when the payload is dropped.
        storage.counters.boundedReads += 1
        storage.counters.returnedBytes += readBytes
      }
      budget.chargedBytes += readBytes
      if (budget.chargedBytes > CURSOR_REMOTE_MAX_AGGREGATE_BYTES) {
        if (storage) {
          storage.truncated.sidecarBytes = true
        }
        throwIfAiVaultScanCancelled(args.signal)
        return null
      }
    }
    throwIfAiVaultScanCancelled(args.signal)

    if (result.issue) {
      args.issues.push(result.issue)
    }
    return result.evidence
      ? {
          layout: 'sidecar' as const,
          storageContextKey: storageKey,
          file: candidate.file,
          cwdEvidence: candidate.cursorCwdEvidence,
          sidecar: result.evidence
        }
      : null
  })
}

function isVerifiedReadTooLargeError(error: unknown): boolean {
  return error instanceof Error && error.message === 'file_too_large'
}
