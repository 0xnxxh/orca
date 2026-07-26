import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  captureGpuInfoSnapshot,
  ensureGpuIdentityCaptured,
  getGpuInfoSnapshot,
  registerGpuIdentitySource,
  resetGpuIdentityCaptureForTesting,
  setGpuInfoSnapshotForTesting,
  summarizeGpuInfo
} from './gpu-info-snapshot'

const COMPLETE_INFO = {
  auxAttributes: {
    glVendor: 'Google Inc. (Intel)',
    glRenderer: 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    glVersion: 'OpenGL ES 2.0.0',
    glImplementation: 'EGL_ANGLE',
    glExtensions: 'GL_EXT_a '.repeat(500),
    basicInfoState: 1,
    contextInfoState: 1,
    initializationTime: 42.5,
    inProcessGpu: false,
    sandboxed: true,
    directComposition: true,
    passthroughCmdDecoder: true
  },
  gpuDevice: [
    { active: false, vendorId: 4318, deviceId: 7938, driverVendor: 'NVIDIA' },
    {
      active: true,
      vendorId: 32902,
      deviceId: 15130,
      driverVendor: 'Intel Corporation',
      driverVersion: '31.0.101.2111',
      deviceString: 'Intel(R) UHD Graphics 620'
    }
  ],
  machineModelName: 'Latitude 5400',
  machineModelVersion: '1.0'
}

describe('summarizeGpuInfo', () => {
  it('flattens the active device and aux attributes', () => {
    const summary = summarizeGpuInfo(COMPLETE_INFO)

    expect(summary).toMatchObject({
      gpuInfoAvailable: true,
      gpuDeviceCount: 2,
      gpuVendorId: '0x8086',
      gpuDeviceId: '0x3b1a',
      gpuDriverVendor: 'Intel Corporation',
      gpuDriverVersion: '31.0.101.2111',
      gpuGlVendor: 'Google Inc. (Intel)',
      gpuAnglePlatform: 'EGL_ANGLE',
      gpuInProcess: false,
      gpuSandboxed: true,
      gpuBasicInfoState: 1,
      gpuInitializationTimeMs: 42.5,
      gpuMachineModel: 'Latitude 5400'
    })
  })

  // Why: glExtensions is kilobytes long and would dominate every crash report.
  it('never copies the extension list and bounds long strings', () => {
    const summary = summarizeGpuInfo(COMPLETE_INFO)

    expect(Object.keys(summary)).not.toContain('gpuGlExtensions')
    for (const value of Object.values(summary)) {
      if (typeof value === 'string') {
        expect(value.length).toBeLessThanOrEqual(160)
      }
    }
  })

  it('falls back to the first device when none is marked active', () => {
    const summary = summarizeGpuInfo({ gpuDevice: [{ vendorId: 4318, deviceId: 7938 }] })
    expect(summary).toMatchObject({ gpuVendorId: '0x10de', gpuDeviceCount: 1 })
  })

  it('reports unavailable for non-object payloads', () => {
    expect(summarizeGpuInfo(null)).toEqual({ gpuInfoAvailable: false })
    expect(summarizeGpuInfo('nope')).toEqual({ gpuInfoAvailable: false })
  })

  it('omits fields the payload does not carry', () => {
    const summary = summarizeGpuInfo({ gpuDevice: [] })
    expect(summary).toEqual({ gpuInfoAvailable: true, gpuDeviceCount: 0 })
  })
})

describe('captureGpuInfoSnapshot', () => {
  afterEach(() => {
    setGpuInfoSnapshotForTesting(null)
    vi.useRealTimers()
  })

  it('caches a successful capture', async () => {
    const snapshot = await captureGpuInfoSnapshot(async () => COMPLETE_INFO, 1_000)
    expect(snapshot.gpuVendorId).toBe('0x8086')
    expect(getGpuInfoSnapshot()).toBe(snapshot)
  })

  it('records the error shape when getGPUInfo rejects', async () => {
    const snapshot = await captureGpuInfoSnapshot(async () => {
      throw new Error('GPU process crashed')
    }, 1_000)
    expect(snapshot).toMatchObject({ gpuInfoAvailable: false, gpuInfoError: 'GPU process crashed' })
    expect(getGpuInfoSnapshot()).toBe(snapshot)
  })

  // Why: on the machines this exists for, the GPU child never initializes and the promise never settles.
  it('times out instead of hanging forever', async () => {
    vi.useFakeTimers()
    const pending = captureGpuInfoSnapshot(() => new Promise(() => {}), 10_000)
    await vi.advanceTimersByTimeAsync(10_000)
    await expect(pending).resolves.toEqual({ gpuInfoAvailable: false, gpuInfoError: 'timeout' })
  })

  // Why: a slow driver that answers after the bound still carries the identity triage needs.
  it('keeps a late-arriving capture that lost the timeout race', async () => {
    vi.useFakeTimers()
    const pending = captureGpuInfoSnapshot(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(COMPLETE_INFO), 11_000)
        }),
      10_000
    )
    await vi.advanceTimersByTimeAsync(10_000)
    await expect(pending).resolves.toMatchObject({ gpuInfoError: 'timeout' })

    await vi.advanceTimersByTimeAsync(1_000)
    expect(getGpuInfoSnapshot()).toMatchObject({ gpuInfoAvailable: true, gpuVendorId: '0x8086' })
  })

  it('does not let a later failure overwrite a successful capture', async () => {
    await captureGpuInfoSnapshot(async () => COMPLETE_INFO, 1_000)
    await captureGpuInfoSnapshot(async () => {
      throw new Error('GPU process crashed')
    }, 1_000)

    expect(getGpuInfoSnapshot()).toMatchObject({ gpuInfoAvailable: true, gpuVendorId: '0x8086' })
  })
})

describe('ensureGpuIdentityCaptured', () => {
  afterEach(() => {
    resetGpuIdentityCaptureForTesting()
    setGpuInfoSnapshotForTesting(null)
    vi.useRealTimers()
  })

  // Why: with no consumer armed (headless serve, unit tests) capture must stay inert.
  it('resolves the cached snapshot without capturing when no source is registered', async () => {
    await expect(ensureGpuIdentityCaptured()).resolves.toBeNull()

    setGpuInfoSnapshotForTesting({ gpuInfoAvailable: false })
    await expect(ensureGpuIdentityCaptured()).resolves.toEqual({ gpuInfoAvailable: false })
  })

  // Why: the whole point of gating — a fallback launch has hardware acceleration
  // disabled, where 'complete' never settles; 'basic' alone must carry vendor/device.
  it('captures basic only when hardware acceleration is disabled', async () => {
    const getGpuInfo = vi.fn().mockResolvedValue({ gpuDevice: COMPLETE_INFO.gpuDevice })
    registerGpuIdentitySource({ getGpuInfo, hardwareAccelerationDisabled: true })

    await expect(ensureGpuIdentityCaptured()).resolves.toMatchObject({
      gpuInfoAvailable: true,
      gpuVendorId: '0x8086'
    })
    expect(getGpuInfo).toHaveBeenCalledTimes(1)
    expect(getGpuInfo).toHaveBeenCalledWith('basic')
  })

  it('skips complete when basic already yields vendor and device', async () => {
    const getGpuInfo = vi.fn().mockResolvedValue({ gpuDevice: COMPLETE_INFO.gpuDevice })
    registerGpuIdentitySource({ getGpuInfo, hardwareAccelerationDisabled: false })

    await expect(ensureGpuIdentityCaptured()).resolves.toMatchObject({ gpuVendorId: '0x8086' })
    expect(getGpuInfo).toHaveBeenCalledTimes(1)
    expect(getGpuInfo).toHaveBeenCalledWith('basic')
  })

  it('escalates to complete when basic lacks device identity', async () => {
    const getGpuInfo = vi.fn((infoType: 'basic' | 'complete') =>
      Promise.resolve(infoType === 'basic' ? { gpuDevice: [] } : COMPLETE_INFO)
    )
    registerGpuIdentitySource({ getGpuInfo, hardwareAccelerationDisabled: false })

    await expect(ensureGpuIdentityCaptured()).resolves.toMatchObject({
      gpuVendorId: '0x8086',
      gpuGlRenderer: expect.stringContaining('ANGLE')
    })
    expect(getGpuInfo).toHaveBeenCalledWith('complete')
  })

  // Why: one attempt per launch — a driver that ignores getGPUInfo must not accrete
  // an orphaned IPC call for every crash in a burst.
  it('captures once per launch even when the first attempt yields nothing', async () => {
    vi.useFakeTimers()
    const getGpuInfo = vi.fn(() => new Promise(() => {}))
    registerGpuIdentitySource({ getGpuInfo, hardwareAccelerationDisabled: false })

    const first = ensureGpuIdentityCaptured()
    const second = ensureGpuIdentityCaptured()
    await vi.advanceTimersByTimeAsync(12_000)

    await expect(first).resolves.toMatchObject({ gpuInfoAvailable: false })
    await expect(second).resolves.toMatchObject({ gpuInfoAvailable: false })
    await expect(ensureGpuIdentityCaptured()).resolves.toMatchObject({ gpuInfoAvailable: false })
    // basic + complete from the single flight; repeat calls started nothing new.
    expect(getGpuInfo).toHaveBeenCalledTimes(2)
  })

  it('returns an already-captured identity without touching the source again', async () => {
    setGpuInfoSnapshotForTesting({ gpuInfoAvailable: true, gpuVendorId: '0x10de' })
    const getGpuInfo = vi.fn()
    registerGpuIdentitySource({ getGpuInfo, hardwareAccelerationDisabled: false })

    await expect(ensureGpuIdentityCaptured()).resolves.toMatchObject({ gpuVendorId: '0x10de' })
    expect(getGpuInfo).not.toHaveBeenCalled()
  })
})
