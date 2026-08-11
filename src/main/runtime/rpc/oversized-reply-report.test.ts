import { describe, expect, it } from 'vitest'
import { REMOTE_RUNTIME_MAX_OUTBOUND_JSON_BYTES } from '../../../shared/remote-runtime-capacity-limits'
import { oversizedReplySizeBucket } from './oversized-reply-report'

const MIB = 1024 * 1024

describe('oversizedReplySizeBucket', () => {
  it.each([
    [REMOTE_RUNTIME_MAX_OUTBOUND_JSON_BYTES + 1, '4_8mb'],
    [8 * MIB, '4_8mb'],
    [8 * MIB + 1, '8_16mb'],
    [16 * MIB, '8_16mb'],
    [16 * MIB + 1, '16_32mb'],
    [32 * MIB, '16_32mb'],
    [32 * MIB + 1, '32_64mb'],
    [64 * MIB, '32_64mb'],
    [64 * MIB + 1, '64mb_plus']
  ])('buckets %i bytes as %s', (byteLength, bucket) => {
    expect(oversizedReplySizeBucket(byteLength)).toBe(bucket)
  })
})
