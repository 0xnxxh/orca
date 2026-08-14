/**
 * OpenSSH `known_hosts` parsing and matching.
 *
 * Hand-rolled because no maintained JS implementation exists. Behaviour was verified against
 * OpenSSH 10.2p1 rather than inferred from the man page — the two lookup passes and the
 * revoked-wins rule in particular are observable behaviours that a reasonable reading of the docs
 * gets wrong. See docs/reference/ssh-host-key-verification.md.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

/** Ordered by severity: the first one that applies decides. */
export type KnownHostsOutcome =
  | 'match'
  | 'mismatch'
  | 'revoked'
  | 'ca-only'
  | 'unknown-type-known-host'
  | 'unknown'

export type KnownHostsEntry = {
  /** `@revoked` / `@cert-authority`; a line with any other marker is dropped at parse time. */
  marker?: 'revoked' | 'cert-authority'
  /** Literal or glob host patterns, lower-cased. Empty when the line is hashed. */
  patterns: string[]
  /** Present only for `|1|salt|hash` lines. */
  hashed?: { salt: Buffer; hash: Buffer }
  /** Whether any pattern on the line is a `!negation`. One negated match vetoes the whole line. */
  negations: string[]
  keyType: string
  key: Buffer
}

const HASH_MAGIC = '|1|'
const SHA1_DIGEST_BYTES = 20
/** Guards a malformed length prefix from allocating or reading past the blob. */
const MAX_KEY_TYPE_BYTES = 64

/**
 * Read the algorithm name from the key blob's own length-prefixed header.
 *
 * Why not trust the line's type field: the two must agree, and comparing them is what rejects a
 * line that claims one algorithm while carrying another.
 */
export function readHostKeyType(key: Buffer): string | undefined {
  if (key.length < 4) {
    return undefined
  }
  const length = key.readUInt32BE(0)
  if (length === 0 || length > MAX_KEY_TYPE_BYTES || 4 + length > key.length) {
    return undefined
  }
  return key.subarray(4, 4 + length).toString('utf8')
}

/** `SHA256:...` exactly as `ssh-keygen -lf` prints it, base64 with padding stripped. */
export function formatHostKeyFingerprint(sha256Base64: string): string {
  return `SHA256:${sha256Base64.replace(/=+$/, '')}`
}

function decodeKey(raw: string): Buffer | undefined {
  // Why the round-trip check: Buffer.from never throws on bad base64, it silently truncates.
  const decoded = Buffer.from(raw, 'base64')
  return decoded.length > 0 ? decoded : undefined
}

function parseHashedPatterns(field: string): KnownHostsEntry['hashed'] | undefined {
  const parts = field.split('|')
  // '' , '1', salt, hash — exactly four, or the line is malformed.
  if (parts.length !== 4 || parts[0] !== '' || parts[1] !== '1') {
    return undefined
  }
  const salt = Buffer.from(parts[2] ?? '', 'base64')
  const hash = Buffer.from(parts[3] ?? '', 'base64')
  if (salt.length === 0 || hash.length !== SHA1_DIGEST_BYTES) {
    return undefined
  }
  return { salt, hash }
}

/** Returns undefined for blank lines, comments, and anything malformed — never throws. */
export function parseKnownHostsLine(line: string): KnownHostsEntry | undefined {
  const trimmed = line.trim()
  if (trimmed.length === 0 || trimmed.startsWith('#')) {
    return undefined
  }

  const fields = trimmed.split(/\s+/)
  let index = 0
  let marker: KnownHostsEntry['marker']
  if (fields[index]?.startsWith('@')) {
    const raw = fields[index]
    if (raw === '@revoked') {
      marker = 'revoked'
    } else if (raw === '@cert-authority') {
      marker = 'cert-authority'
    } else {
      // Why drop rather than ignore the marker: an unrecognised marker may restrict the line in a
      // way we do not model, so honouring the line as if it were unmarked would over-trust it.
      return undefined
    }
    index += 1
  }

  const hostField = fields[index]
  const keyType = fields[index + 1]
  const keyBase64 = fields[index + 2]
  if (!hostField || !keyType || !keyBase64) {
    return undefined
  }

  const key = decodeKey(keyBase64)
  if (!key || readHostKeyType(key) !== keyType) {
    return undefined
  }

  if (hostField.startsWith(HASH_MAGIC)) {
    const hashed = parseHashedPatterns(hostField)
    return hashed
      ? { ...(marker ? { marker } : {}), patterns: [], negations: [], hashed, keyType, key }
      : undefined
  }

  const patterns: string[] = []
  const negations: string[] = []
  for (const raw of hostField.split(',')) {
    const pattern = raw.trim().toLowerCase()
    if (pattern.length === 0) {
      continue
    }
    if (pattern.startsWith('!')) {
      negations.push(pattern.slice(1))
    } else {
      patterns.push(pattern)
    }
  }
  if (patterns.length === 0 && negations.length === 0) {
    return undefined
  }
  return { ...(marker ? { marker } : {}), patterns, negations, keyType, key }
}

export function parseKnownHosts(contents: string): KnownHostsEntry[] {
  const entries: KnownHostsEntry[] = []
  for (const line of contents.split(/\r?\n/)) {
    const entry = parseKnownHostsLine(line)
    if (entry) {
      entries.push(entry)
    }
  }
  return entries
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${escaped.replace(/\*/g, '.*').replace(/\?/g, '.')}$`)
}

function patternMatches(pattern: string, candidate: string): boolean {
  return pattern.includes('*') || pattern.includes('?')
    ? globToRegExp(pattern).test(candidate)
    : pattern === candidate
}

function entryMatchesCandidate(entry: KnownHostsEntry, candidate: string): boolean {
  if (entry.hashed) {
    // The hash covers the candidate form verbatim, so a bracketed candidate hashes as
    // "[host]:port" — each form must be hashed separately rather than hashing the bare host once.
    const digest = createHmac('sha1', entry.hashed.salt).update(candidate).digest()
    return digest.length === entry.hashed.hash.length && timingSafeEqual(digest, entry.hashed.hash)
  }
  // A single negation vetoes the entire line even when another pattern on it matches.
  if (entry.negations.some((pattern) => patternMatches(pattern, candidate))) {
    return false
  }
  return entry.patterns.some((pattern) => patternMatches(pattern, candidate))
}

/**
 * The candidate forms, in the order OpenSSH tries them.
 *
 * A non-default port looks up `[host]:port` first and, finding nothing, retries the bare host —
 * "checking without port identifier" in `ssh -v`. Collapsing these into one set would give a
 * spurious first-contact result to anyone holding a bare line who connects on a non-default port.
 */
export function hostCandidatePasses(host: string, port: number): string[][] {
  const lower = host.toLowerCase()
  return port === 22 ? [[lower]] : [[`[${lower}]:${port}`], [lower]]
}

export type KnownHostsQuery = {
  host: string
  port: number
  keyType: string
  key: Buffer
}

/**
 * Decide an outcome for one presented key against a set of entries.
 *
 * Entries from several files are unioned by the caller: any exact hit in any file wins, and a
 * disagreeing entry in another file does not make it a mismatch.
 */
export function matchKnownHosts(
  entries: readonly KnownHostsEntry[],
  query: KnownHostsQuery
): KnownHostsOutcome {
  const passes = hostCandidatePasses(query.host, query.port)
  const matchesHost = (entry: KnownHostsEntry, candidates: string[]): boolean =>
    candidates.some((candidate) => entryMatchesCandidate(entry, candidate))

  // Revocation resolves first, across every pass, so the verdict cannot depend on line order.
  for (const candidates of passes) {
    for (const entry of entries) {
      if (
        entry.marker === 'revoked' &&
        matchesHost(entry, candidates) &&
        entry.key.equals(query.key)
      ) {
        return 'revoked'
      }
    }
  }

  let sawKnownHostOtherType = false
  let sawCertAuthority = false

  for (let passIndex = 0; passIndex < passes.length; passIndex += 1) {
    const candidates = passes[passIndex]!
    let sawSameTypeForHost = false

    for (const entry of entries) {
      if (entry.marker === 'revoked' || !matchesHost(entry, candidates)) {
        continue
      }
      if (entry.marker === 'cert-authority') {
        // A CA line only validates certificates; it never matches a plain host key.
        sawCertAuthority = true
        continue
      }
      if (entry.keyType === query.keyType) {
        if (entry.key.equals(query.key)) {
          return 'match'
        }
        sawSameTypeForHost = true
      } else {
        sawKnownHostOtherType = true
      }
    }

    // Only the first (most specific) pass may report a change. On the fallback pass OpenSSH
    // downgrades a wrong key to "not known", so reporting mismatch there would be a false alarm.
    if (sawSameTypeForHost && passIndex === 0) {
      return 'mismatch'
    }
  }

  if (sawCertAuthority) {
    return 'ca-only'
  }
  // We hold a key for this host, just not of the presented type. Not first contact — an attacker
  // who cannot forge the known type could otherwise present a different one to get a soft outcome.
  return sawKnownHostOtherType ? 'unknown-type-known-host' : 'unknown'
}
