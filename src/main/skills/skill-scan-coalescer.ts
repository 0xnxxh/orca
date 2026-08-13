/** `cached` is false when this call did the filesystem work, for diagnostics. */
export type SkillScanOutcome<T> = { value: T; cached: boolean }

export type SkillScanRunOptions = {
  /** 0 keeps nothing after the scan settles, so the entry only dedups concurrent callers. */
  ttlMs: number
  /** Skip every cached and in-flight result and re-read disk. */
  refresh?: boolean
}

type CacheEntry<T> = { value: T; expiresAt: number }
type PendingEntry<T> = { promise: Promise<T>; startedAt: number }

// Why: a root on a stalled network mount can leave a readdir that never settles.
// Joining it forever would make one wedged mount permanently wedge discovery for
// every later caller — worse than before this cache existed, where each caller at
// least retried. Past this age a new caller starts its own scan instead; the old
// promise is dropped, so at most one pending entry per key survives.
const MAX_JOINABLE_SCAN_AGE_MS = 30_000

/**
 * Shares one filesystem scan between concurrent callers and, optionally, reuses
 * its result for a short window.
 *
 * Keys are used verbatim — callers must not normalize case, because two paths
 * that differ only by case can be two different targets on Linux.
 */
export class SkillScanCoalescer<T> {
  private readonly pending = new Map<string, PendingEntry<T>>()
  private readonly cache = new Map<string, CacheEntry<T>>()
  // Why: deleting the cache entry is not enough to invalidate. A scan that began
  // before the mutation resolves afterwards and would re-cache its pre-mutation
  // result with a fresh lifetime, so the install that triggered the refresh reads
  // as missing for a full window. Every scan carries the epoch it started under
  // and may only publish while that epoch is still current.
  private epoch = 0

  constructor(
    private readonly maximumEntries: number,
    private readonly now: () => number = Date.now
  ) {}

  async run(
    key: string,
    options: SkillScanRunOptions,
    task: () => Promise<T>
  ): Promise<SkillScanOutcome<T>> {
    if (options.refresh) {
      // Why: a forced caller is answering a mutation it just made, so it must not
      // join a scan that may have started before that mutation. Concurrent forced
      // callers therefore duplicate; they are rare (install / explicit recheck).
      this.epoch += 1
      this.cache.delete(key)
      return { value: await this.start(key, options.ttlMs, task), cached: false }
    }
    const fresh = this.readFresh(key)
    if (fresh) {
      return { value: fresh.value, cached: true }
    }
    const inFlight = this.pending.get(key)
    if (inFlight && this.now() - inFlight.startedAt < MAX_JOINABLE_SCAN_AGE_MS) {
      return { value: await inFlight.promise, cached: true }
    }
    return { value: await this.start(key, options.ttlMs, task), cached: false }
  }

  /** Drop every cached and in-flight entry (e.g. after a skill update run). */
  clear(): void {
    this.epoch += 1
    this.cache.clear()
    this.pending.clear()
  }

  private start(key: string, ttlMs: number, task: () => Promise<T>): Promise<T> {
    const epoch = this.epoch
    const promise = task()
      .then((value) => {
        if (ttlMs > 0 && epoch === this.epoch) {
          this.write(key, value, ttlMs)
        }
        return value
      })
      .finally(() => {
        // Why: a newer forced scan may already own this key; only the entry that
        // registered itself may remove itself.
        if (this.pending.get(key)?.promise === promise) {
          this.pending.delete(key)
        }
      })
    // Why: rejections must not surface as an unhandled rejection on the shared
    // promise before the caller that started it awaits.
    promise.catch(() => undefined)
    this.pending.set(key, { promise, startedAt: this.now() })
    return promise
  }

  private readFresh(key: string): CacheEntry<T> | null {
    const entry = this.cache.get(key)
    if (!entry) {
      return null
    }
    if (entry.expiresAt <= this.now()) {
      this.cache.delete(key)
      return null
    }
    // Refresh recency so a hot root outlives a one-off target under the bound.
    this.cache.delete(key)
    this.cache.set(key, entry)
    return entry
  }

  private write(key: string, value: T, ttlMs: number): void {
    this.cache.delete(key)
    this.cache.set(key, { value, expiresAt: this.now() + ttlMs })
    while (this.cache.size > this.maximumEntries) {
      const oldestKey = this.cache.keys().next().value
      if (oldestKey === undefined) {
        break
      }
      this.cache.delete(oldestKey)
    }
  }
}
