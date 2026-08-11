export const RESPONSE_TOO_LARGE_CODE = 'response_too_large'
// Why: no path, method or user content — this string reaches every paired client verbatim.
export const RESPONSE_TOO_LARGE_MESSAGE =
  'The response is too large to send over a remote connection.'

export type OversizedReplyReport = {
  /** Registry-validated method name, or 'unknown' — never the raw client-supplied string. */
  method: string
  byteLength: number
  streaming: boolean
}

export type OversizedReplySizeBucket = '4_8mb' | '8_16mb' | '16_32mb' | '32_64mb' | '64mb_plus'

const MIB = 1024 * 1024

// Why: buckets, not raw byte counts, cross the telemetry boundary — a payload size is user data.
export function oversizedReplySizeBucket(byteLength: number): OversizedReplySizeBucket {
  if (byteLength <= 8 * MIB) {
    return '4_8mb'
  }
  if (byteLength <= 16 * MIB) {
    return '8_16mb'
  }
  if (byteLength <= 32 * MIB) {
    return '16_32mb'
  }
  return byteLength <= 64 * MIB ? '32_64mb' : '64mb_plus'
}
