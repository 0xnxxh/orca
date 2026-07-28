import { describe, expect, it } from 'vitest'
import { JsonStringifyByteLimitError } from '../../shared/memory-safety/node-bounded-json-stringify'
import { stringifyJsonWithinByteLimit } from '../../shared/memory-safety/node-bounded-json-stringify'
import { WINDOWS_SSH_UPLOAD_PACKAGE_MAX_BYTES } from './ssh-directory-transfer-budget'

type WindowsUploadEntry =
  | { kind: 'directory'; path: string }
  | { kind: 'file'; path: string; contentsBase64: string }

/** Builds a package whose serialized size straddles the ceiling without allocating far past it. */
function packageOfSerializedSize(targetBytes: number): WindowsUploadEntry[] {
  const entries: WindowsUploadEntry[] = [{ kind: 'directory', path: 'C:\\dst' }]
  const overhead = JSON.stringify([
    ...entries,
    { kind: 'file', path: 'C:\\dst\\f', contentsBase64: '' }
  ]).length
  entries.push({
    kind: 'file',
    path: 'C:\\dst\\f',
    contentsBase64: 'a'.repeat(Math.max(0, targetBytes - overhead))
  })
  return entries
}

describe('windows SSH upload package ceiling', () => {
  it('serializes a package at the exact 48 MiB ceiling', () => {
    // Literal ceiling: sizing the fixture from the constant would pass at any value.
    expect(WINDOWS_SSH_UPLOAD_PACKAGE_MAX_BYTES).toBe(48 * 1024 * 1024)

    const entries = packageOfSerializedSize(48 * 1024 * 1024)
    const result = stringifyJsonWithinByteLimit(entries, WINDOWS_SSH_UPLOAD_PACKAGE_MAX_BYTES)

    expect(result.byteLength).toBe(48 * 1024 * 1024)
  })

  it('rejects a package one byte past the ceiling instead of buffering it', () => {
    const entries = packageOfSerializedSize(48 * 1024 * 1024 + 1)

    expect(() =>
      stringifyJsonWithinByteLimit(entries, WINDOWS_SSH_UPLOAD_PACKAGE_MAX_BYTES)
    ).toThrow(JsonStringifyByteLimitError)
  })
})
