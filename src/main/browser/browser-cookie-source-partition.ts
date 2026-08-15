import type { CookieClearPartitionKey } from './browser-cookie-import-clear'

// Why (STA-4300): a partition identity that cannot be read faithfully must skip the cookie, never
// downgrade it. An unpartitioned write of a partitioned cookie looks like a success and leaves the
// site unable to see its own session — the failure mode that produced STA-4013/4061/4090/4170.
export type SourcePartitionRead =
  | { status: 'unpartitioned' }
  | { status: 'partitioned'; partitionKey: CookieClearPartitionKey }
  | { status: 'unreadable'; reason: string }

const CHROMIUM_PARTITION_SITE_COLUMN = 'top_frame_site_key'
const CHROMIUM_CROSS_SITE_ANCESTOR_COLUMN = 'has_cross_site_ancestor'

const UNPARTITIONED: SourcePartitionRead = { status: 'unpartitioned' }

function readSqliteFlag(raw: unknown): boolean | null {
  if (typeof raw === 'boolean') {
    return raw
  }
  if (typeof raw === 'bigint') {
    return raw !== 0n
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw !== 0
  }
  return null
}

/**
 * Reads a Chromium cookie row's partition identity.
 *
 * Chromium stores the partition as `top_frame_site_key` (empty string when unpartitioned) plus
 * `has_cross_site_ancestor`, which older schemas predate. Both halves are required: a partition key
 * written with the wrong ancestor bit files the cookie under a partition the site never reads, which
 * is indistinguishable from losing it.
 */
export function readChromiumRowPartition(
  sourceRow: Record<string, unknown>,
  sourceColumns: ReadonlySet<string>
): SourcePartitionRead {
  // Why: a schema without the column predates cookie partitioning, so every row is genuinely
  // unpartitioned — that is a faithful read, not a missing one.
  if (!sourceColumns.has(CHROMIUM_PARTITION_SITE_COLUMN)) {
    return UNPARTITIONED
  }

  const rawSite = sourceRow[CHROMIUM_PARTITION_SITE_COLUMN]
  if (rawSite === null || rawSite === undefined || rawSite === '') {
    return UNPARTITIONED
  }
  if (typeof rawSite !== 'string') {
    return { status: 'unreadable', reason: 'partition site column was not text' }
  }

  if (!sourceColumns.has(CHROMIUM_CROSS_SITE_ANCESTOR_COLUMN)) {
    return {
      status: 'unreadable',
      reason: 'source schema has no cross-site-ancestor column for a partitioned cookie'
    }
  }
  const hasCrossSiteAncestor = readSqliteFlag(sourceRow[CHROMIUM_CROSS_SITE_ANCESTOR_COLUMN])
  if (hasCrossSiteAncestor === null) {
    return { status: 'unreadable', reason: 'cross-site-ancestor column was not an integer flag' }
  }

  return { status: 'partitioned', partitionKey: { topLevelSite: rawSite, hasCrossSiteAncestor } }
}

const FIREFOX_PARTITION_KEY_PATTERN = /(?:^|&|\^)partitionKey=\(([^)]*)\)/

/**
 * Reads a Firefox cookie's partition identity from its `originAttributes` suffix.
 *
 * Firefox encodes two different things in the same field. A two-part key —
 * `^partitionKey=(https,example.com)` — is dFPI: storage isolation *the browser imposed* on an
 * ordinary cookie, which Chromium re-derives for itself, so the cookie the server sent is genuinely
 * unpartitioned. A longer key carries `isPartitionedAttributeSet`, meaning the server sent
 * `Partitioned` — a real CHIPS cookie. That identity cannot be rebuilt for Chromium, because Firefox
 * records no cross-site-ancestor bit, so it is skipped and reported rather than downgraded.
 */
export function readFirefoxOriginAttributesPartition(raw: unknown): SourcePartitionRead {
  if (raw === undefined || raw === null || raw === '') {
    return UNPARTITIONED
  }
  if (typeof raw !== 'string') {
    return { status: 'unreadable', reason: 'originAttributes was not text' }
  }

  let suffix = raw
  try {
    suffix = decodeURIComponent(raw)
  } catch {
    // Why: a malformed escape is not proof of a partition; fall back to the raw suffix.
  }
  const match = FIREFOX_PARTITION_KEY_PATTERN.exec(suffix)
  if (!match || match[1].split(',').length <= 2) {
    return UNPARTITIONED
  }
  return {
    status: 'unreadable',
    reason: 'Firefox partitioned-attribute cookie has no cross-site-ancestor bit to read'
  }
}

/**
 * Reads a JSON cookie entry's partition identity.
 *
 * Absent means unpartitioned — every mainstream exporter omits the field for ordinary cookies, so
 * treating absence as unreadable would reject whole exports. Present-but-incomplete is unreadable:
 * exporters that emit only `topLevelSite` (or the legacy CDP string form) carry no ancestor bit, and
 * guessing it silently misfiles the cookie.
 */
export function readJsonCookiePartition(raw: unknown): SourcePartitionRead {
  if (raw === undefined || raw === null || raw === '') {
    return UNPARTITIONED
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { status: 'unreadable', reason: 'partitionKey was not an object with both fields' }
  }

  const { topLevelSite, hasCrossSiteAncestor } = raw as Record<string, unknown>
  if (typeof topLevelSite !== 'string' || topLevelSite.length === 0) {
    return { status: 'unreadable', reason: 'partitionKey.topLevelSite was missing or not text' }
  }
  if (typeof hasCrossSiteAncestor !== 'boolean') {
    return {
      status: 'unreadable',
      reason: 'partitionKey.hasCrossSiteAncestor was missing or not a boolean'
    }
  }

  return { status: 'partitioned', partitionKey: { topLevelSite, hasCrossSiteAncestor } }
}
