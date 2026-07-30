import { describe, expect, it, vi } from 'vitest'
import {
  captureMobileProcessMemorySnapshot,
  normalizeNativeProcessMemoryBytes,
  type NativeProcessMemoryMeasurement
} from './mobile-process-memory-diagnostics'

const IOS_MEASUREMENT: NativeProcessMemoryMeasurement = {
  metric: 'physical-footprint',
  value: 12_345,
  unit: 'bytes',
  processRole: 'app',
  pid: 41,
  sampledAtMs: 1_722_000_000_000
}

const ANDROID_MEASUREMENT: NativeProcessMemoryMeasurement = {
  metric: 'proportional-set-size',
  value: 2_048,
  unit: 'kibibytes',
  processRole: 'app',
  pid: 42,
  sampledAtMs: 1_722_000_000_001
}

describe('mobile process-memory diagnostics', () => {
  it('normalizes native byte and KiB units to bytes', () => {
    expect(normalizeNativeProcessMemoryBytes(IOS_MEASUREMENT)).toBe(12_345)
    expect(normalizeNativeProcessMemoryBytes(ANDROID_MEASUREMENT)).toBe(2_097_152)
  })

  it('rejects invalid native byte values', () => {
    expect(() =>
      normalizeNativeProcessMemoryBytes({ ...IOS_MEASUREMENT, value: Number.NaN })
    ).toThrow()
    expect(() => normalizeNativeProcessMemoryBytes({ ...IOS_MEASUREMENT, value: -1 })).toThrow()
  })

  it.each([
    ['ios', IOS_MEASUREMENT, 12_345, 'physical-footprint'],
    ['android', ANDROID_MEASUREMENT, 2_097_152, 'proportional-set-size']
  ] as const)(
    'attributes a supported %s app-process sample',
    async (platform, raw, bytes, metric) => {
      const snapshot = await captureMobileProcessMemorySnapshot(platform, () => raw)

      expect(snapshot).toMatchObject({
        platform,
        supportStatus: 'supported',
        processRole: 'app',
        pid: raw.pid,
        metric,
        bytes,
        byteUnit: 'bytes',
        sampledAtMs: raw.sampledAtMs,
        webContentProcessAttribution: 'unsupported-unattributed',
        limitation: 'public-sandbox-api-unavailable',
        errorKind: null
      })
    }
  )

  it('reports unsupported platforms without calling native code', async () => {
    const readNative = vi.fn()

    const snapshot = await captureMobileProcessMemorySnapshot('web', readNative, () => 77)

    expect(readNative).not.toHaveBeenCalled()
    expect(snapshot).toMatchObject({
      platform: 'other',
      supportStatus: 'unsupported',
      bytes: null,
      sampledAtMs: 77
    })
  })

  it('turns native failures into a bounded error without copying messages', async () => {
    const snapshot = await captureMobileProcessMemorySnapshot(
      'ios',
      () => {
        throw new Error('/private/worktree credential failed')
      },
      () => 88
    )

    expect(snapshot).toMatchObject({
      supportStatus: 'error',
      bytes: null,
      sampledAtMs: 88,
      errorKind: 'native-error'
    })
    expect(JSON.stringify(snapshot)).not.toContain('credential')
  })

  it('rejects a native metric attributed to the wrong platform', async () => {
    const snapshot = await captureMobileProcessMemorySnapshot('ios', () => ANDROID_MEASUREMENT)

    expect(snapshot.supportStatus).toBe('error')
    expect(snapshot.bytes).toBeNull()
  })

  it('uses a fixed privacy-safe schema', async () => {
    const snapshot = await captureMobileProcessMemorySnapshot('ios', () => IOS_MEASUREMENT)

    expect(Object.keys(snapshot).sort()).toEqual(
      [
        'byteUnit',
        'bytes',
        'errorKind',
        'limitation',
        'metric',
        'pid',
        'platform',
        'processRole',
        'sampledAtMs',
        'supportStatus',
        'webContentProcessAttribution'
      ].sort()
    )
  })
})
