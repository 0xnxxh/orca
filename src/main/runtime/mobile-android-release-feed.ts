import { net } from 'electron'
import { compareVersions, isValidVersion } from '../updater-fallback'

// Why: the Android app is distributed as an APK from GitHub Releases, so the
// release list IS the source of truth for "latest Android build" — never a
// hand-maintained constant. iOS is deliberately absent: it ships through the
// App Store, which auto-updates, and the hard minimum-version cutoff is handled
// separately by ProtocolBlockScreen, so no soft iOS nudge is derived here.

const RELEASES_API_URL = 'https://api.github.com/repos/stablyai/orca/releases?per_page=100'
const FETCH_TIMEOUT_MS = 5000
// Why: a mobile build ships ~monthly, so a long TTL keeps this to a few
// unauthenticated GitHub calls per day per host while staying fresh enough.
const CACHE_TTL_MS = 6 * 60 * 60 * 1000
// Why: only exact Android release tags count, so suffixed RC builds never nudge stable users.
const ANDROID_TAG_RE = /^mobile-android-v(\d+\.\d+\.\d+)$/

type ReleaseFeedEntry = {
  tag_name?: unknown
  draft?: unknown
  prerelease?: unknown
}

type CacheState = {
  version: string | null
  fetchedAt: number
}

type ReleaseFeedResponse = Pick<Response, 'ok' | 'json'>
type ReleaseFeedFetcher = () => Promise<ReleaseFeedResponse>

const defaultReleaseFeedFetcher: ReleaseFeedFetcher = () =>
  net.fetch(RELEASES_API_URL, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'orca-runtime' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  })

// Module-level cache shared across every status.get on this host.
let cache: CacheState | null = null
let inFlight: Promise<void> | null = null
let releaseFeedFetcher = defaultReleaseFeedFetcher

export function extractLatestAndroidVersion(entries: ReleaseFeedEntry[]): string | null {
  let latest: string | null = null
  for (const entry of entries) {
    // Mobile releases intentionally use GitHub's prerelease flag so they do not
    // replace the desktop's latest release; the strict tag defines this channel.
    if (entry.draft === true) {
      continue
    }
    if (typeof entry.tag_name !== 'string') {
      continue
    }
    const match = entry.tag_name.match(ANDROID_TAG_RE)
    const version = match?.[1]
    if (!version || !isValidVersion(version)) {
      continue
    }
    if (latest === null || compareVersions(version, latest) > 0) {
      latest = version
    }
  }
  return latest
}

async function fetchLatestAndroidVersion(): Promise<string | null> {
  try {
    const response = await releaseFeedFetcher()
    if (!response.ok) {
      return null
    }
    const body = (await response.json()) as unknown
    if (!Array.isArray(body)) {
      return null
    }
    return extractLatestAndroidVersion(body as ReleaseFeedEntry[])
  } catch {
    // Why: fail open — an unreachable/rate-limited/offline host simply advertises
    // no recommendation, and mobile shows no banner.
    return null
  }
}

function refreshInBackground(now: number): void {
  if (inFlight) {
    return
  }
  inFlight = fetchLatestAndroidVersion()
    .then((version) => {
      // Why: keep the last-known version on a failed refresh (null result) so a
      // transient outage doesn't drop an already-correct nudge; only the
      // timestamp advances, deferring the next retry by one TTL.
      cache = { version: version ?? cache?.version ?? null, fetchedAt: now }
    })
    .catch(() => {
      cache = { version: cache?.version ?? null, fetchedAt: now }
    })
    .finally(() => {
      inFlight = null
    })
}

// Why: status.get is a hot, synchronous RPC, so never block it on the network —
// return the cached value and kick a background refresh when stale
// (stale-while-revalidate). First call returns null (no banner) until the first
// fetch lands, which is the correct fail-open default.
export function getRecommendedAndroidVersion(nowMs: number): string | null {
  if (cache === null || nowMs - cache.fetchedAt > CACHE_TTL_MS) {
    refreshInBackground(nowMs)
  }
  return cache?.version ?? null
}

export function isAndroidReleaseFeedRefreshPending(): boolean {
  return inFlight !== null
}

// Test-only: reset module cache between cases.
export function __resetAndroidReleaseFeedCacheForTests(): void {
  cache = null
  inFlight = null
  releaseFeedFetcher = defaultReleaseFeedFetcher
}

// Test-only: seed the cache with a fresh value so status.get reads it without
// hitting the network.
export function __setAndroidReleaseFeedCacheForTests(version: string | null): void {
  cache = { version, fetchedAt: Date.now() }
  inFlight = null
}

export function __setAndroidReleaseFeedFetcherForTests(fetcher: ReleaseFeedFetcher): void {
  releaseFeedFetcher = fetcher
}
