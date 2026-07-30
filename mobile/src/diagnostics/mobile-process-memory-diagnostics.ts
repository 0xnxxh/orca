import type { NativeProcessMemoryMeasurement } from '@orca/expo-process-memory'

export type { NativeProcessMemoryMeasurement } from '@orca/expo-process-memory'

export type MobileProcessMemoryPlatform = 'ios' | 'android' | 'other'

export type MobileProcessMemorySnapshot = Readonly<{
  platform: MobileProcessMemoryPlatform
  supportStatus: 'supported' | 'unsupported' | 'error'
  processRole: 'app'
  pid: number | null
  metric: NativeProcessMemoryMeasurement['metric'] | null
  bytes: number | null
  byteUnit: 'bytes'
  sampledAtMs: number
  webContentProcessAttribution: 'unsupported-unattributed'
  limitation: 'public-sandbox-api-unavailable'
  errorKind: 'native-error' | null
}>

type NativeMemoryReader = () =>
  | NativeProcessMemoryMeasurement
  | Promise<NativeProcessMemoryMeasurement>

const BYTE_MULTIPLIER: Record<NativeProcessMemoryMeasurement['unit'], number> = {
  bytes: 1,
  kibibytes: 1024
}

export function normalizeNativeProcessMemoryBytes(
  measurement: NativeProcessMemoryMeasurement
): number {
  const bytes = measurement.value * BYTE_MULTIPLIER[measurement.unit]
  if (!Number.isFinite(bytes) || bytes < 0 || !Number.isSafeInteger(Math.round(bytes))) {
    throw new Error('Invalid native process-memory measurement')
  }
  return Math.round(bytes)
}

export async function captureMobileProcessMemorySnapshot(
  platform: string,
  readNative: NativeMemoryReader,
  now: () => number = Date.now
): Promise<MobileProcessMemorySnapshot> {
  const normalizedPlatform: MobileProcessMemoryPlatform =
    platform === 'ios' || platform === 'android' ? platform : 'other'
  const base = {
    platform: normalizedPlatform,
    processRole: 'app' as const,
    byteUnit: 'bytes' as const,
    webContentProcessAttribution: 'unsupported-unattributed' as const,
    limitation: 'public-sandbox-api-unavailable' as const
  }
  if (normalizedPlatform === 'other') {
    return {
      ...base,
      supportStatus: 'unsupported',
      pid: null,
      metric: null,
      bytes: null,
      sampledAtMs: now(),
      errorKind: null
    }
  }
  try {
    const measurement = await readNative()
    const expectedMetric =
      normalizedPlatform === 'ios' ? 'physical-footprint' : 'proportional-set-size'
    const expectedUnit = normalizedPlatform === 'ios' ? 'bytes' : 'kibibytes'
    if (
      measurement.processRole !== 'app' ||
      measurement.metric !== expectedMetric ||
      measurement.unit !== expectedUnit ||
      !Number.isFinite(measurement.sampledAtMs)
    ) {
      throw new Error('Invalid native process-memory attribution')
    }
    return {
      ...base,
      supportStatus: 'supported',
      pid: Number.isSafeInteger(measurement.pid) && measurement.pid > 0 ? measurement.pid : null,
      metric: measurement.metric,
      bytes: normalizeNativeProcessMemoryBytes(measurement),
      sampledAtMs: measurement.sampledAtMs,
      errorKind: null
    }
  } catch {
    return {
      ...base,
      supportStatus: 'error',
      pid: null,
      metric: null,
      bytes: null,
      sampledAtMs: now(),
      errorKind: 'native-error'
    }
  }
}

export async function readMobileProcessMemorySnapshot(
  platform: string
): Promise<MobileProcessMemorySnapshot> {
  return captureMobileProcessMemorySnapshot(platform, async () => {
    const { default: nativeModule } = await import('@orca/expo-process-memory')
    return nativeModule.getProcessMemory()
  })
}
