import type { HostedReviewInfo } from '../../shared/hosted-review'
import {
  __resetHostedReviewLookupBackoffForTests,
  backoffUntil,
  clearFailures,
  dropFailuresWithPrefix,
  noteFailure
} from './hosted-review-lookup-backoff'
import {
  ACTIVE_CLAIM_TTL_MS,
  ACTIVE_REFRESH_INTERVAL_MS,
  HOSTED_REVIEW_LOOKUP_DEADLINE_MS,
  MAX_ACTIVE_BRANCHES,
  MAX_INFLIGHT_LOOKUPS,
  NO_REVIEW_REFRESH_INTERVAL_MS
} from './hosted-review-refresh-pacing'

/**
 * Process-wide cache for branch review lookups (#11532).
 *
 * `hostedReview:forBranch` is polled by every desktop window, the mobile client
 * and `orca serve` alike, and each one used to reach the provider directly. The
 * host's API quota is per user, so the only place that can pace them together is
 * here — the single funnel they all pass through.
 *
 * Pacing is tiered by what the user is looking at rather than applied flat: the
 * selected worktree is O(1) and can afford a per-minute re-check, while the
 * worktree list is O(N) and is what exhausts the budget.
 */

// Why: a found review still refreshes at the callers' poll cadence; the cache
// exists to collapse concurrent clients, not to make review state go stale.
const FOUND_REVIEW_TTL_MS = 60_000
const MAX_ENTRIES = 500

type CacheEntry = {
  review: HostedReviewInfo | null
  fetchedAt: number
  headOid: string | null
}

type InflightRecord = {
  /** Identity, so a detached lookup can only ever clear its own entry. */
  token: object
  startedAt: number
  promise: Promise<HostedReviewInfo | null>
  /** Releases the callers and unpins the branch; idempotent. */
  expire: () => void
}

const entries = new Map<string, CacheEntry>()
const inflight = new Map<string, InflightRecord>()
/** Branches a caller reported as its current selection, least recent first. */
const activeClaims = new Map<string, number>()
/** Bumped per repo on invalidation so a lookup that predates it cannot store. */
const scopeGenerations = new Map<string, number>()

// Why: NUL is the one byte a repo path or branch name cannot contain, so a
// scope prefix cannot straddle a component boundary — invalidating `/a/b` must
// not also flush the unrelated repo at `/a/b c`.
const KEY_SEPARATOR = '\0'

export type HostedReviewBranchCacheIdentity = {
  repoPath: string
  connectionId?: string | null
  branch: string
  linkedGitHubPR?: number | null
  fallbackGitHubPR?: number | null
  linkedGitLabMR?: number | null
  linkedBitbucketPR?: number | null
  linkedAzureDevOpsPR?: number | null
  linkedGiteaPR?: number | null
  localGitExecOptions?: unknown
}

export type HostedReviewBranchCacheOptions = {
  /** The worktree's checked-out HEAD oid, for merged-at-head visibility. */
  headOid: string | null
  /** Set by surfaces that only ever render the selected worktree. */
  active?: boolean
}

/** Repo-scoped prefix so a single repo's entries can be dropped without a full flush. */
function repoScope(repoPath: string, connectionId?: string | null): string {
  return `${connectionId ?? ''}${KEY_SEPARATOR}${repoPath}`
}

export function hostedReviewBranchCacheKey(identity: HostedReviewBranchCacheIdentity): string {
  return [
    repoScope(identity.repoPath, identity.connectionId),
    identity.branch,
    // Each linked id selects a different lookup, so it belongs in the identity.
    identity.linkedGitHubPR ?? '',
    identity.fallbackGitHubPR ?? '',
    identity.linkedGitLabMR ?? '',
    identity.linkedBitbucketPR ?? '',
    identity.linkedAzureDevOpsPR ?? '',
    identity.linkedGiteaPR ?? '',
    identity.localGitExecOptions ? JSON.stringify(identity.localGitExecOptions) : ''
  ].join(KEY_SEPARATOR)
}

/**
 * Records the caller's current selection, reporting whether the branch was not
 * already active. Claims are least-recently-used so the fast tier stays bounded
 * no matter how many a client asserts.
 */
function noteActiveClaim(key: string): boolean {
  const now = Date.now()
  for (const [candidate, claimedAt] of activeClaims) {
    if (now - claimedAt > ACTIVE_CLAIM_TTL_MS) {
      activeClaims.delete(candidate)
    }
  }
  const wasActive = activeClaims.has(key)
  activeClaims.delete(key)
  activeClaims.set(key, now)
  while (activeClaims.size > MAX_ACTIVE_BRANCHES) {
    const oldest = activeClaims.keys().next().value
    if (oldest === undefined) {
      break
    }
    activeClaims.delete(oldest)
  }
  return !wasActive
}

function isActiveBranch(key: string): boolean {
  const claimedAt = activeClaims.get(key)
  return claimedAt !== undefined && Date.now() - claimedAt <= ACTIVE_CLAIM_TTL_MS
}

// Why: a merged review is the one answer that depends on the inspected head —
// the merged-at-head carve-out keeps it visible only while the head matches.
// Negative answers are deliberately head-insensitive, so a branch under active
// commits cannot defeat the long no-review interval.
function isHeadSensitive(entry: CacheEntry): boolean {
  return entry.review?.state === 'merged'
}

function refreshIntervalMs(entry: CacheEntry, active: boolean): number {
  if (entry.review !== null) {
    return FOUND_REVIEW_TTL_MS
  }
  return active ? ACTIVE_REFRESH_INTERVAL_MS : NO_REVIEW_REFRESH_INTERVAL_MS
}

function isFresh(entry: CacheEntry, headOid: string | null, active: boolean): boolean {
  if (isHeadSensitive(entry) && headOid !== null && entry.headOid !== null) {
    if (headOid !== entry.headOid) {
      return false
    }
  }
  return Date.now() - entry.fetchedAt < refreshIntervalMs(entry, active)
}

function storeEntry(key: string, entry: CacheEntry): void {
  entries.delete(key)
  entries.set(key, entry)
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value
    if (oldest === undefined) {
      break
    }
    entries.delete(oldest)
  }
}

function scopeGeneration(scope: string): number {
  return scopeGenerations.get(scope) ?? 0
}

function bumpScopeGeneration(scope: string): void {
  const next = scopeGeneration(scope) + 1
  scopeGenerations.delete(scope)
  scopeGenerations.set(scope, next)
  // Why: an evicted scope reads as generation 0, which only makes a lookup in
  // flight at eviction discard its result — a wasted call, never a stale one.
  while (scopeGenerations.size > MAX_ENTRIES) {
    const oldest = scopeGenerations.keys().next().value
    if (oldest === undefined) {
      break
    }
    scopeGenerations.delete(oldest)
  }
}

/** Clears the key's in-flight record only if it is still this lookup's. */
function releaseInflight(key: string, token: object): boolean {
  if (inflight.get(key)?.token !== token) {
    return false
  }
  inflight.delete(key)
  return true
}

/**
 * Expires records that outlived the deadline without their timer firing. Main's
 * timers are suspended across a system sleep, so wall-clock age — not
 * `setTimeout` alone — is what actually bounds how long a branch stays pinned.
 */
function expireOverdueInflight(now: number): void {
  let overdue: InflightRecord[] | undefined
  for (const record of inflight.values()) {
    if (now - record.startedAt >= HOSTED_REVIEW_LOOKUP_DEADLINE_MS) {
      overdue ??= []
      overdue.push(record)
    }
  }
  // Expire after the walk: each one deletes its own entry from the map.
  for (const record of overdue ?? []) {
    record.expire()
  }
}

function trackInflight(key: string, record: InflightRecord): void {
  inflight.set(key, record)
  while (inflight.size > MAX_INFLIGHT_LOOKUPS) {
    const oldest = inflight.keys().next().value
    if (oldest === undefined) {
      break
    }
    // Why: drop the record without expiring it — its own deadline still
    // releases its callers, and evicting is about memory, not about failing.
    inflight.delete(oldest)
  }
}

/**
 * Drops every cached answer for a repo. Called when Orca itself opens a review,
 * so the new one is visible immediately instead of after the no-review interval.
 */
export function invalidateHostedReviewBranchCache(
  repoPath: string,
  connectionId?: string | null
): void {
  const scope = repoScope(repoPath, connectionId)
  bumpScopeGeneration(scope)
  const prefix = `${scope}${KEY_SEPARATOR}`
  for (const key of entries.keys()) {
    if (key.startsWith(prefix)) {
      entries.delete(key)
    }
  }
  dropFailuresWithPrefix(prefix)
}

/** @internal - exposed for tests only */
export function __resetHostedReviewBranchCacheForTests(): void {
  entries.clear()
  inflight.clear()
  __resetHostedReviewLookupBackoffForTests()
  activeClaims.clear()
  scopeGenerations.clear()
}

/** A newer lookup has already answered for this key since `startedAt`. */
function answeredSince(key: string, startedAt: number): boolean {
  const current = entries.get(key)
  return current !== undefined && current.fetchedAt >= startedAt
}

/**
 * Runs one lookup under a deadline. Nothing below this can be cancelled, so the
 * deadline *detaches* instead: the branch is unpinned and the callers hear a
 * failure, while the lookup keeps running and its answer is still adopted if it
 * ever lands. That is what lets a wedged host recover in-session (P1-D).
 */
function startLookup(
  key: string,
  scope: string,
  headOid: string | null,
  lookup: () => Promise<HostedReviewInfo | null>
): Promise<HostedReviewInfo | null> {
  const startedAt = Date.now()
  const generation = scopeGeneration(scope)
  const token = {}
  /** The deadline released the callers; the lookup itself runs on, detached. */
  let timedOut = false
  let completed = false
  let release: (review: HostedReviewInfo | null) => void = () => {}
  let fail: (error: unknown) => void = () => {}
  const promise = new Promise<HostedReviewInfo | null>((resolve, reject) => {
    release = resolve
    fail = reject
  })
  let timer: ReturnType<typeof setTimeout> | undefined

  const expire = (): void => {
    if (timedOut || completed) {
      return
    }
    timedOut = true
    if (timer !== undefined) {
      clearTimeout(timer)
    }
    // Why: only the lookup still serving this key shapes the backoff. A record
    // already replaced — or dropped by the size cap — has a live successor, and
    // penalising the branch would slow down the retry that is already running.
    if (releaseInflight(key, token)) {
      noteFailure(key)
    }
    const stale = entries.get(key)
    if (stale) {
      release(stale.review)
      return
    }
    fail(
      new Error(
        `Hosted review lookup timed out after ${Math.round(
          HOSTED_REVIEW_LOOKUP_DEADLINE_MS / 1000
        )}s. It will be retried on a later poll.`
      )
    )
  }

  timer = setTimeout(expire, HOSTED_REVIEW_LOOKUP_DEADLINE_MS)
  if (typeof timer === 'object' && 'unref' in timer) {
    timer.unref()
  }
  // Why: track before running, so a lookup that throws synchronously clears the
  // record it would otherwise leave behind for a full deadline.
  trackInflight(key, { token, startedAt, promise, expire })

  void (async () => {
    try {
      const review = await lookup()
      // Why: a review created while this lookup was out makes its answer older
      // than the invalidation; storing it would re-pin the stale "no review".
      // A timed-out lookup additionally yields to whatever answered after it
      // started, so a slow straggler cannot overwrite the current answer.
      if (generation === scopeGeneration(scope) && !(timedOut && answeredSince(key, startedAt))) {
        storeEntry(key, { review, fetchedAt: Date.now(), headOid })
        // A late answer proves the provider recovered, so stop backing off.
        clearFailures(key)
      }
      release(review)
    } catch (error) {
      // Why: the deadline already counted this lookup as a failure and released
      // its callers; counting the late rejection again would double-escalate.
      if (timedOut) {
        return
      }
      noteFailure(key)
      // Why: the last good review beats an error card here just as it does on
      // the backed-off path — otherwise it blinks out on the first failure.
      // An invalidation drops the entry, so this cannot revive a retired answer.
      const stale = entries.get(key)
      if (stale) {
        release(stale.review)
        return
      }
      fail(error)
    } finally {
      completed = true
      if (timer !== undefined) {
        clearTimeout(timer)
      }
      releaseInflight(key, token)
    }
  })()

  return promise
}

/**
 * Serves `lookup` through the shared cache: a fresh answer is reused, concurrent
 * callers share one in-flight lookup, and a failing branch backs off instead of
 * being re-asked at every caller's poll cadence.
 */
export async function withHostedReviewBranchCache(
  identity: HostedReviewBranchCacheIdentity,
  options: HostedReviewBranchCacheOptions,
  lookup: () => Promise<HostedReviewInfo | null>
): Promise<HostedReviewInfo | null> {
  const key = hostedReviewBranchCacheKey(identity)
  const headOid = options.headOid
  // Why: sweep first, so a lookup whose deadline never fired cannot be joined —
  // that is the pin this cache used to hold until the process restarted.
  expireOverdueInflight(Date.now())
  if (options.active === true && noteActiveClaim(key) && entries.get(key)?.review === null) {
    // Why: switching to a worktree is the user asking whether a review exists
    // yet, so the long no-review interval must not answer on their behalf. This
    // is the cheap half of the fast tier — it costs one lookup per selection
    // rather than one per minute.
    entries.delete(key)
  }
  const active = isActiveBranch(key)

  const cached = entries.get(key)
  if (cached && isFresh(cached, headOid, active)) {
    return cached.review
  }

  const pending = inflight.get(key)
  if (pending) {
    return pending.promise
  }

  const until = backoffUntil(key)
  if (until !== null) {
    // Why: a stale answer beats an error card, but with nothing cached the
    // caller must hear the failure rather than read it as "no review".
    if (cached) {
      return cached.review
    }
    throw new Error(
      `Hosted review lookup is backing off after repeated failures. Retrying after ${new Date(
        until
      ).toLocaleTimeString()}.`
    )
  }

  return startLookup(key, repoScope(identity.repoPath, identity.connectionId), headOid, lookup)
}
