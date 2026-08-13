import { readTranscriptSlice } from './wsl-transcript-fs-access'

const BOUNDARY_FINGERPRINT_BYTES = 64

/**
 * Fingerprint the bytes immediately before `offset`, so a same-size rewrite that
 * leaves mtime untouched is still detected as replaced content rather than
 * treated as an append the reader already consumed.
 */
export async function boundaryFingerprint(
  filePath: string,
  offset: number,
  signal?: AbortSignal
): Promise<string> {
  if (offset <= 0) {
    return ''
  }
  const start = Math.max(0, offset - BOUNDARY_FINGERPRINT_BYTES)
  const slice = await readTranscriptSlice(filePath, start, offset - start, 'exact', signal)
  return slice.toString('base64')
}
