import { jsonStringBytes } from './node-json-byte-measurement'
import { REMOTE_RUNTIME_MAX_OUTBOUND_CONTENT_BYTES } from './remote-runtime-capacity-limits'
import type { GitDiffResult } from './types'

export const GIT_DIFF_MAX_TRANSPORT_CONTENT_BYTES = REMOTE_RUNTIME_MAX_OUTBOUND_CONTENT_BYTES

export const GIT_DIFF_TOO_LARGE_CODE = 'diff_too_large'
export const GIT_DIFF_TOO_LARGE_MESSAGE = 'This diff is too large to open over a remote connection.'

// Why: JSON escaping turns one control byte into six (\u00XX), and binary-buffer.ts sniffs only for
// NUL in the first 8 KiB, so control-dense content is classified as text — a raw-byte cap would
// admit it and the serialized reply would then blow the envelope.
const MAX_JSON_ESCAPE_EXPANSION = 6
const JSON_QUOTE_BYTES_PER_SIDE = 2

/**
 * Bytes the diff's content sides occupy once JSON-encoded. The value crosses `maxBytes` exactly
 * when the encoded content does; it is only exact when the escape-aware scan runs.
 */
export function gitDiffTransportContentBytes(result: GitDiffResult, maxBytes: number): number {
  // Why: the SSH provider casts a relay payload to GitDiffResult without validating it, so a
  // skewed relay version can omit a side; treat a missing one as empty rather than throwing here.
  const sides = [result.originalContent, result.modifiedContent].filter(
    (side): side is string => typeof side === 'string'
  )
  let rawBytes = 0
  for (const side of sides) {
    rawBytes += Buffer.byteLength(side, 'utf8')
  }
  // Why: escaping never shrinks and never grows past 6x, so both bounds settle the verdict
  // without walking multi-megabyte strings; only the band between them needs the exact count.
  if (
    rawBytes * MAX_JSON_ESCAPE_EXPANSION + sides.length * JSON_QUOTE_BYTES_PER_SIDE <= maxBytes ||
    rawBytes > maxBytes
  ) {
    return rawBytes
  }
  let bytes = 0
  for (const side of sides) {
    bytes += jsonStringBytes(side, maxBytes - bytes)
    if (bytes > maxBytes) {
      return bytes
    }
  }
  return bytes
}

/** `maxBytes === undefined` means uncapped: local and in-process callers keep full fidelity. */
export function assertGitDiffWithinTransportBudget<T extends GitDiffResult>(
  result: T,
  maxBytes: number | undefined
): T {
  if (maxBytes === undefined) {
    return result
  }
  const byteLength = gitDiffTransportContentBytes(result, maxBytes)
  if (byteLength <= maxBytes) {
    return result
  }
  throw Object.assign(new Error(GIT_DIFF_TOO_LARGE_MESSAGE), {
    code: GIT_DIFF_TOO_LARGE_CODE,
    data: { byteLength, maxBytes }
  })
}
