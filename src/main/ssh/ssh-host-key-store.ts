/**
 * Orca's own record of accepted SSH host keys, consulted alongside the user's `known_hosts`.
 *
 * We read `known_hosts` but never write it (D1), so accepted keys land here instead. See
 * docs/reference/ssh-host-key-verification.md — D1, D5 and D8 are the load-bearing decisions.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { withSidecarSnapshotQueue, writeSidecarSnapshot } from '../sidecar-snapshot-file'
import {
  formatHostKeyFingerprint,
  readHostKeyType,
  type KnownHostsOutcome,
  type KnownHostsQuery
} from './ssh-known-hosts'

const STORE_FILE_NAME = 'ssh-host-keys.json'
const STORE_VERSION = 1
const MAX_PORT = 65535

export type TrustedHostKeyRecord = {
  /** Lower-cased `HostKeyAlias` or resolved hostname — never the Orca target label (D2 lookup key). */
  host: string
  port: number
  keyType: string
  /** The presented blob, base64. Matching compares these bytes; the fingerprint is for display. */
  key: string
  fingerprint: string
  acceptedAt: string
}

/**
 * Our store holds neither CA nor revoked entries, so it can only reach four of the six outcomes —
 * but they are the same four, so a caller can union this with `matchKnownHosts` untranslated.
 */
export type HostKeyStoreOutcome = Extract<
  KnownHostsOutcome,
  'match' | 'mismatch' | 'unknown-type-known-host' | 'unknown'
>

type HostKeyStoreFile = {
  version: number
  hostKeys: TrustedHostKeyRecord[]
}

/** Beside the profile's data file, like the GitHub cache and scrollback snapshots. */
export function getSshHostKeyStoreFile(dataFile: string): string {
  return join(dirname(dataFile), STORE_FILE_NAME)
}

let configuredStoreFile: string | null = null

/** Bind the store to the active profile once at startup, so connect paths need not thread `dataFile`. */
export function initSshHostKeyStoreFile(dataFile: string): void {
  configuredStoreFile = getSshHostKeyStoreFile(dataFile)
}

/**
 * Why throw rather than default to empty: an unconfigured store is a wiring bug, and answering
 * "nothing trusted" would quietly turn every host into first contact. The verifier wraps its work
 * and denies on throw (D7), so failing loudly here still fails closed.
 */
function requireStoreFile(file?: string): string {
  const resolved = file ?? configuredStoreFile
  if (!resolved) {
    throw new Error('SSH host key store used before initSshHostKeyStoreFile()')
  }
  return resolved
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase()
}

function isValidPort(port: unknown): port is number {
  return typeof port === 'number' && Number.isInteger(port) && port > 0 && port <= MAX_PORT
}

function decodeStoredKey(record: TrustedHostKeyRecord): Buffer | undefined {
  // Buffer.from never throws on bad base64, it silently truncates — so re-derive and compare.
  const key = Buffer.from(record.key, 'base64')
  if (
    key.length === 0 ||
    key.toString('base64').replace(/=+$/, '') !== record.key.replace(/=+$/, '')
  ) {
    return undefined
  }
  // The blob's own algorithm header must agree with the record's type field, or a tampered or
  // corrupted record could claim a type it does not carry and satisfy a lookup for it.
  return readHostKeyType(key) === record.keyType ? key : undefined
}

function fingerprintOf(key: Buffer): string {
  return formatHostKeyFingerprint(createHash('sha256').update(key).digest('base64'))
}

function validateRecord(candidate: unknown): TrustedHostKeyRecord | undefined {
  if (!candidate || typeof candidate !== 'object') {
    return undefined
  }
  const { host, port, keyType, key, fingerprint, acceptedAt } = candidate as Record<string, unknown>
  if (
    typeof host !== 'string' ||
    host.length === 0 ||
    !isValidPort(port) ||
    typeof keyType !== 'string' ||
    keyType.length === 0 ||
    typeof key !== 'string' ||
    typeof fingerprint !== 'string' ||
    typeof acceptedAt !== 'string'
  ) {
    return undefined
  }
  const record: TrustedHostKeyRecord = {
    host: normalizeHost(host),
    port,
    keyType,
    key,
    fingerprint,
    acceptedAt
  }
  const decoded = decodeStoredKey(record)
  // A fingerprint that disagrees with its key means the record was corrupted or hand-edited; D5
  // shows this fingerprint to the user, so a record we cannot vouch for is dropped rather than shown.
  return decoded && fingerprintOf(decoded) === fingerprint ? record : undefined
}

/**
 * Every trusted record, or an empty list when the file is missing or unreadable.
 *
 * Never throws and never fails open: a corrupt file degrades to "nothing trusted", which costs a
 * first-contact prompt, where the opposite mistake would accept anything.
 */
export async function loadTrustedHostKeys(file?: string): Promise<TrustedHostKeyRecord[]> {
  const storeFile = requireStoreFile(file)
  let contents: string
  try {
    contents = await readFile(storeFile, 'utf-8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[ssh] Could not read the host key store at ${storeFile}:`, error)
    }
    return []
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(contents)
  } catch {
    console.warn(`[ssh] Host key store at ${storeFile} is not valid JSON; treating it as empty`)
    return []
  }

  const hostKeys = (parsed as Partial<HostKeyStoreFile> | null)?.hostKeys
  if (!Array.isArray(hostKeys)) {
    console.warn(`[ssh] Host key store at ${storeFile} has no host key list; treating it as empty`)
    return []
  }

  const records: TrustedHostKeyRecord[] = []
  let dropped = 0
  for (const candidate of hostKeys) {
    const record = validateRecord(candidate)
    if (record) {
      records.push(record)
    } else {
      dropped += 1
    }
  }
  if (dropped > 0) {
    console.warn(
      `[ssh] Ignored ${dropped} unusable record(s) in the host key store at ${storeFile}`
    )
  }
  return records
}

/**
 * Whether these records hold this key for this endpoint.
 *
 * Scoped to host + port + key type (D8), and exactly — unlike `known_hosts` there is no bare-host
 * fallback pass, because we only ever record the endpoint we actually connected to.
 *
 * Pure and separate from the load so the connect path can reuse it against records it preloaded:
 * ssh2's verifier decides synchronously and cannot await the file. Duplicating the comparison there
 * instead is what produced the type downgrade this outcome set exists to prevent — one copy answered
 * only match/mismatch/unknown, so a record of another type read as first contact.
 */
export function matchTrustedHostKeys(
  records: readonly TrustedHostKeyRecord[],
  query: KnownHostsQuery
): HostKeyStoreOutcome {
  const host = normalizeHost(query.host)
  let sawSameType = false
  let sawOtherType = false

  for (const record of records) {
    if (record.host !== host || record.port !== query.port) {
      continue
    }
    if (record.keyType !== query.keyType) {
      sawOtherType = true
      continue
    }
    if (decodeStoredKey(record)?.equals(query.key)) {
      return 'match'
    }
    sawSameType = true
  }

  if (sawSameType) {
    return 'mismatch'
  }
  // We hold a key for this endpoint, just not of the presented type. Never a first-contact result:
  // an attacker who cannot forge the type on file would otherwise present another for a soft outcome.
  return sawOtherType ? 'unknown-type-known-host' : 'unknown'
}

/** The key types we already hold for one endpoint, for the algorithm ordering that makes D3 safe. */
export function storedKeyTypesForEndpoint(
  records: readonly TrustedHostKeyRecord[],
  host: string,
  port: number
): string[] {
  const normalized = normalizeHost(host)
  return records
    .filter((record) => record.host === normalized && record.port === port)
    .map((record) => record.keyType)
}

/** Whether we have previously accepted this key for this endpoint. */
export async function isTrusted(
  query: KnownHostsQuery,
  file?: string
): Promise<HostKeyStoreOutcome> {
  return matchTrustedHostKeys(await loadTrustedHostKeys(file), query)
}

/**
 * Record an accepted key, superseding any earlier key for the same host + port + type.
 *
 * Takes the presented blob rather than a pre-built record so the stored base64 and fingerprint
 * cannot disagree with each other.
 */
export async function trustHostKey(
  query: KnownHostsQuery,
  file?: string
): Promise<TrustedHostKeyRecord> {
  const storeFile = requireStoreFile(file)
  const record: TrustedHostKeyRecord = {
    host: normalizeHost(query.host),
    port: query.port,
    keyType: query.keyType,
    key: query.key.toString('base64'),
    fingerprint: fingerprintOf(query.key),
    acceptedAt: new Date().toISOString()
  }
  // Serialized: startup restore connects to every previously-active target in parallel, so two
  // first-contact accepts can otherwise read the same snapshot and one overwrites the other.
  await withSidecarSnapshotQueue(storeFile, async () => {
    const kept = (await loadTrustedHostKeys(storeFile)).filter(
      (existing) =>
        existing.host !== record.host ||
        existing.port !== record.port ||
        existing.keyType !== record.keyType
    )
    await persist(storeFile, [...kept, record])
  })
  console.warn(
    `[ssh] Trusted host key for ${record.host}:${record.port} (${record.keyType} ${record.fingerprint})`
  )
  return record
}

/**
 * Drop trust for an endpoint — the D5 recovery path, which is the only cure for a rotated key
 * because we never learn one from `UpdateHostKeys`. Omit `keyType` to forget every type.
 * Returns how many records were removed, so the settings surface can say whether it did anything.
 */
export async function forgetHostKey(
  target: { host: string; port: number; keyType?: string },
  file?: string
): Promise<number> {
  const storeFile = requireStoreFile(file)
  const host = normalizeHost(target.host)
  return withSidecarSnapshotQueue(storeFile, async () => {
    const records = await loadTrustedHostKeys(storeFile)
    const kept = records.filter(
      (record) =>
        record.host !== host ||
        record.port !== target.port ||
        (target.keyType !== undefined && record.keyType !== target.keyType)
    )
    const removed = records.length - kept.length
    if (removed > 0) {
      await persist(storeFile, kept)
      console.warn(
        `[ssh] Forgot ${removed} stored host key(s) for ${host}:${target.port}${target.keyType ? ` (${target.keyType})` : ''}`
      )
    }
    return removed
  })
}

/** Temp file + fsync + rename, so a crash mid-write can never publish a half-written trust list. */
async function persist(storeFile: string, hostKeys: TrustedHostKeyRecord[]): Promise<void> {
  await mkdir(dirname(storeFile), { recursive: true }).catch(() => {})
  await writeSidecarSnapshot(storeFile, {
    version: STORE_VERSION,
    hostKeys
  } satisfies HostKeyStoreFile)
}
