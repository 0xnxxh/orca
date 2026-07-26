import {
  sanitizeCrashReportDetails,
  type CrashReportBreadcrumbData
} from '../../shared/crash-reporting'

/**
 * Driver identity for crash details.
 *
 * Nothing in the main process called app.getGPUInfo() before, so every GPU
 * crash bundle arrived without a vendor, device or driver version — triage
 * could not tell a broken driver from a broken machine.
 *
 * Capture is lazy: most users never produce a GPU crash report, so a healthy
 * launch must not spend startup on GPU IPC. index.ts registers a source, and
 * the first crash that needs identity triggers a one-attempt-per-launch capture.
 */

/** Bounded so a pathological glExtensions-style string can't dominate the report. */
const MAX_GPU_STRING_LENGTH = 160

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null
}

function pickString(source: UnknownRecord | null, key: string): string | undefined {
  const value = source?.[key]
  return typeof value === 'string' && value.length > 0
    ? value.slice(0, MAX_GPU_STRING_LENGTH)
    : undefined
}

function pickNumber(source: UnknownRecord | null, key: string): number | undefined {
  const value = source?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function pickBoolean(source: UnknownRecord | null, key: string): boolean | undefined {
  const value = source?.[key]
  return typeof value === 'boolean' ? value : undefined
}

/** Vendor/device ids arrive as numbers; hex is what driver bug reports are indexed by. */
function formatPciId(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `0x${Math.trunc(value).toString(16).padStart(4, '0')}`
  }
  return typeof value === 'string' && value.length > 0
    ? value.slice(0, MAX_GPU_STRING_LENGTH)
    : undefined
}

function selectGpuDevice(raw: UnknownRecord | null): UnknownRecord | null {
  const devices = raw?.gpuDevice
  if (!Array.isArray(devices) || devices.length === 0) {
    return null
  }
  const records = devices.map(asRecord).filter((device): device is UnknownRecord => device !== null)
  return records.find((device) => device.active === true) ?? records[0] ?? null
}

/**
 * Flattens `app.getGPUInfo('complete')` into crash-detail scalars. Pure so the
 * shape can be tested without an Electron GPU process.
 */
export function summarizeGpuInfo(raw: unknown): CrashReportBreadcrumbData {
  const root = asRecord(raw)
  if (!root) {
    return { gpuInfoAvailable: false }
  }
  const aux = asRecord(root.auxAttributes)
  const device = selectGpuDevice(root)
  const devices = Array.isArray(root.gpuDevice) ? root.gpuDevice.length : 0

  return sanitizeCrashReportDetails({
    gpuInfoAvailable: true,
    gpuDeviceCount: devices,
    gpuVendorId: formatPciId(device?.vendorId),
    gpuDeviceId: formatPciId(device?.deviceId),
    gpuDriverVendor: pickString(device, 'driverVendor'),
    gpuDriverVersion: pickString(device, 'driverVersion'),
    gpuDeviceString: pickString(device, 'deviceString'),
    gpuGlVendor: pickString(aux, 'glVendor'),
    gpuGlRenderer: pickString(aux, 'glRenderer'),
    gpuGlVersion: pickString(aux, 'glVersion'),
    gpuAnglePlatform: pickString(aux, 'glImplementation'),
    gpuBasicInfoState: pickNumber(aux, 'basicInfoState'),
    gpuContextInfoState: pickNumber(aux, 'contextInfoState'),
    gpuInitializationTimeMs: pickNumber(aux, 'initializationTime'),
    gpuInProcess: pickBoolean(aux, 'inProcessGpu'),
    gpuSandboxed: pickBoolean(aux, 'sandboxed'),
    gpuDirectComposition: pickBoolean(aux, 'directComposition'),
    gpuPassthroughCmdDecoder: pickBoolean(aux, 'passthroughCmdDecoder'),
    gpuMachineModel: pickString(root, 'machineModelName'),
    gpuMachineModelVersion: pickString(root, 'machineModelVersion')
  })
}

let gpuInfoSnapshot: CrashReportBreadcrumbData | null = null

export function getGpuInfoSnapshot(): CrashReportBreadcrumbData | null {
  return gpuInfoSnapshot
}

export function setGpuInfoSnapshotForTesting(snapshot: CrashReportBreadcrumbData | null): void {
  gpuInfoSnapshot = snapshot
}

/**
 * Only ever trade up. A timeout placeholder must not overwrite real device data,
 * and a late-but-successful capture must be allowed to replace one that already did.
 */
function cacheGpuInfoSnapshot(snapshot: CrashReportBreadcrumbData): void {
  if (gpuInfoSnapshot === null || snapshot.gpuInfoAvailable === true) {
    gpuInfoSnapshot = snapshot
  }
}

/**
 * Captures the snapshot once, off the startup critical path. On a machine whose
 * GPU child CHECK-crashes at init this call can hang forever, so it is bounded
 * and records the failure shape rather than nothing.
 */
export async function captureGpuInfoSnapshot(
  getGpuInfo: () => Promise<unknown>,
  timeoutMs: number
): Promise<CrashReportBreadcrumbData> {
  let timer: NodeJS.Timeout | undefined
  const capture = (async () => summarizeGpuInfo(await getGpuInfo()))()
  // Why: the timeout bounds how long callers wait, not whether the result is kept —
  // a driver that answers at 11s still has the identity triage needs.
  void capture.then(cacheGpuInfoSnapshot).catch(() => {})
  try {
    const snapshot = await Promise.race([
      capture,
      new Promise<CrashReportBreadcrumbData>((resolve) => {
        timer = setTimeout(
          () => resolve({ gpuInfoAvailable: false, gpuInfoError: 'timeout' }),
          timeoutMs
        )
        timer.unref?.()
      })
    ])
    cacheGpuInfoSnapshot(snapshot)
    return snapshot
  } catch (error) {
    const snapshot = sanitizeCrashReportDetails({
      gpuInfoAvailable: false,
      gpuInfoError: error instanceof Error ? error.message : String(error)
    })
    cacheGpuInfoSnapshot(snapshot)
    return snapshot
  } finally {
    if (timer) {
      clearTimeout(timer)
    }
  }
}

/** Short: 'basic' is answered by the browser process and should not need the wait. */
export const GPU_BASIC_INFO_TIMEOUT_MS = 2_000

/** 'complete' needs a live GPU child; on broken drivers it answers late or never. */
export const GPU_COMPLETE_INFO_TIMEOUT_MS = 10_000

export type GpuIdentitySource = {
  getGpuInfo: (infoType: 'basic' | 'complete') => Promise<unknown>
  /** A fallback-tier launch has hardware acceleration off, where 'complete' never settles. */
  hardwareAccelerationDisabled: boolean
}

let gpuIdentitySource: GpuIdentitySource | null = null
let gpuIdentityCapture: Promise<CrashReportBreadcrumbData | null> | null = null

/** Arms lazy capture; never registered in headless serve, where a 'complete' probe could provoke a GPU child. */
export function registerGpuIdentitySource(source: GpuIdentitySource): void {
  gpuIdentitySource = source
}

export function resetGpuIdentityCaptureForTesting(): void {
  gpuIdentitySource = null
  gpuIdentityCapture = null
}

function hasDeviceIdentity(snapshot: CrashReportBreadcrumbData | null): boolean {
  return (
    snapshot?.gpuInfoAvailable === true &&
    (snapshot.gpuVendorId !== undefined || snapshot.gpuDeviceId !== undefined)
  )
}

/**
 * Lazy, single-flight identity capture — one attempt per launch, so a driver that
 * ignores getGPUInfo cannot accrete an orphaned IPC call per crash.
 *
 * 'basic' reports gpuDevice (vendorId/deviceId/machineModel) from the browser process
 * without a healthy GPU child, so it goes first; 'complete' only runs when the device
 * identity is still missing and hardware acceleration is on — every launch that records
 * a GPU crash under a fallback tier has it disabled, which is exactly when 'complete'
 * never settles.
 *
 * Resolves null when no source is registered and nothing was ever cached.
 */
export function ensureGpuIdentityCaptured(): Promise<CrashReportBreadcrumbData | null> {
  if (hasDeviceIdentity(gpuInfoSnapshot)) {
    return Promise.resolve(gpuInfoSnapshot)
  }
  const source = gpuIdentitySource
  if (!source) {
    return Promise.resolve(gpuInfoSnapshot)
  }
  gpuIdentityCapture ??= (async () => {
    const basic = await captureGpuInfoSnapshot(
      () => source.getGpuInfo('basic'),
      GPU_BASIC_INFO_TIMEOUT_MS
    )
    if (source.hardwareAccelerationDisabled || hasDeviceIdentity(getGpuInfoSnapshot())) {
      return getGpuInfoSnapshot() ?? basic
    }
    const complete = await captureGpuInfoSnapshot(
      () => source.getGpuInfo('complete'),
      GPU_COMPLETE_INFO_TIMEOUT_MS
    )
    // Why: report what triage will actually read — a timed-out 'complete' leaves the
    // richer 'basic' result cached.
    return getGpuInfoSnapshot() ?? complete
  })()
  return gpuIdentityCapture
}
