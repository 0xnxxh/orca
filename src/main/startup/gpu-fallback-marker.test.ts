import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  GPU_FALLBACK_MARKER_FILE,
  clearGpuFallbackMarker,
  readActiveGpuFallbackMarker,
  readGpuFallbackMarker,
  readGpuFallbackMarkerResult,
  writeGpuFallbackMarker
} from './gpu-fallback-marker'

describe('gpu-fallback-marker', () => {
  let userDataPath: string
  const environment = {
    appVersion: '1.2.3',
    electronVersion: '42.3.3',
    platform: 'win32' as const
  }

  beforeEach(() => {
    userDataPath = mkdtempSync(join(os.tmpdir(), 'orca-gpu-fallback-test-'))
  })

  afterEach(() => {
    rmSync(userDataPath, { recursive: true, force: true })
  })

  it('round-trips a written marker', () => {
    writeGpuFallbackMarker(
      userDataPath,
      { engagedAt: 123, crashesInWindow: 3, tier: 2 },
      environment
    )
    expect(readGpuFallbackMarker(userDataPath)).toEqual({
      schemeVersion: 3,
      engagedAt: 123,
      crashesInWindow: 3,
      tier: 2,
      appVersion: '1.2.3',
      electronVersion: '42.3.3',
      platform: 'win32'
    })
  })

  it('leaves no temp file behind after an atomic write', () => {
    writeGpuFallbackMarker(userDataPath, { engagedAt: 1, crashesInWindow: 3, tier: 1 }, environment)
    expect(existsSync(join(userDataPath, `${GPU_FALLBACK_MARKER_FILE}.tmp`))).toBe(false)
  })

  it('overwrites an existing marker when escalating tiers', () => {
    writeGpuFallbackMarker(userDataPath, { engagedAt: 1, crashesInWindow: 3, tier: 1 }, environment)
    writeGpuFallbackMarker(userDataPath, { engagedAt: 2, crashesInWindow: 4, tier: 3 }, environment)
    expect(readGpuFallbackMarker(userDataPath)?.tier).toBe(3)
  })

  it('returns null when no marker exists', () => {
    expect(readGpuFallbackMarker(userDataPath)).toBeNull()
    expect(readGpuFallbackMarkerResult(userDataPath)).toEqual({ status: 'absent' })
    expect(readActiveGpuFallbackMarker(userDataPath, environment)).toEqual({
      marker: null,
      cleared: null,
      unreadableErrorCode: null
    })
  })

  it('keeps an active marker for repeated launches on the same build', () => {
    writeGpuFallbackMarker(userDataPath, { engagedAt: 1, crashesInWindow: 4, tier: 2 }, environment)
    expect(existsSync(join(userDataPath, GPU_FALLBACK_MARKER_FILE))).toBe(true)

    const firstRead = readActiveGpuFallbackMarker(userDataPath, environment)
    expect(firstRead.marker?.crashesInWindow).toBe(4)
    expect(firstRead.marker?.tier).toBe(2)
    expect(existsSync(join(userDataPath, GPU_FALLBACK_MARKER_FILE))).toBe(true)

    expect(readActiveGpuFallbackMarker(userDataPath, environment).marker?.tier).toBe(2)
  })

  it('clamps an out-of-range persisted tier onto the ladder', () => {
    writeFileSync(
      join(userDataPath, GPU_FALLBACK_MARKER_FILE),
      JSON.stringify({
        schemeVersion: 3,
        engagedAt: 1,
        crashesInWindow: 3,
        tier: 99,
        appVersion: '1.2.3',
        electronVersion: '42.3.3',
        platform: 'win32'
      })
    )
    expect(readGpuFallbackMarker(userDataPath)?.tier).toBe(3)
  })

  it('defaults a marker with no tier to the first rung', () => {
    writeFileSync(
      join(userDataPath, GPU_FALLBACK_MARKER_FILE),
      JSON.stringify({
        schemeVersion: 3,
        engagedAt: 1,
        crashesInWindow: 3,
        appVersion: '1.2.3',
        electronVersion: '42.3.3',
        platform: 'win32'
      })
    )
    expect(readGpuFallbackMarker(userDataPath)?.tier).toBe(1)
  })

  it('clears an active marker when the app build changes', () => {
    writeGpuFallbackMarker(userDataPath, { engagedAt: 1, crashesInWindow: 4, tier: 1 }, environment)

    expect(
      readActiveGpuFallbackMarker(userDataPath, {
        ...environment,
        appVersion: '1.2.4'
      })
    ).toEqual({ marker: null, cleared: 'stale-build', unreadableErrorCode: null })
    expect(existsSync(join(userDataPath, GPU_FALLBACK_MARKER_FILE))).toBe(false)
  })

  it('clears an active marker outside Windows', () => {
    writeGpuFallbackMarker(userDataPath, { engagedAt: 1, crashesInWindow: 4, tier: 1 }, environment)

    expect(
      readActiveGpuFallbackMarker(userDataPath, {
        ...environment,
        platform: 'linux'
      })
    ).toEqual({ marker: null, cleared: 'non-windows', unreadableErrorCode: null })
    expect(existsSync(join(userDataPath, GPU_FALLBACK_MARKER_FILE))).toBe(false)
  })

  // Why: enableMainProcessGpuFeatures() is skipped while GPU fallback is active, and that function
  // carries the macOS disable-skia-graphite fix. A marker that survived on darwin would silently
  // strip the fix from the Macs it targets, so pin the platform gate for darwin specifically.
  it('clears an active marker on macOS so the Graphite fix is never skipped', () => {
    writeGpuFallbackMarker(userDataPath, { engagedAt: 1, crashesInWindow: 4, tier: 1 }, environment)

    expect(
      readActiveGpuFallbackMarker(userDataPath, {
        ...environment,
        platform: 'darwin'
      })
    ).toEqual({ marker: null, cleared: 'non-windows', unreadableErrorCode: null })
    expect(existsSync(join(userDataPath, GPU_FALLBACK_MARKER_FILE))).toBe(false)
  })

  it('clears a corrupt or wrong-version marker', () => {
    writeFileSync(join(userDataPath, GPU_FALLBACK_MARKER_FILE), '{ not json')
    expect(readGpuFallbackMarkerResult(userDataPath)).toEqual({ status: 'invalid' })
    expect(readActiveGpuFallbackMarker(userDataPath, environment)).toEqual({
      marker: null,
      cleared: 'invalid',
      unreadableErrorCode: null
    })
    expect(existsSync(join(userDataPath, GPU_FALLBACK_MARKER_FILE))).toBe(false)

    writeFileSync(
      join(userDataPath, GPU_FALLBACK_MARKER_FILE),
      JSON.stringify({ schemeVersion: 999, engagedAt: 1, crashesInWindow: 1 })
    )
    expect(readGpuFallbackMarker(userDataPath)).toBeNull()
    expect(readActiveGpuFallbackMarker(userDataPath, environment).cleared).toBe('invalid')
    expect(existsSync(join(userDataPath, GPU_FALLBACK_MARKER_FILE))).toBe(false)
  })

  // Why: deleting an unreadable marker silently re-armed hardware acceleration on
  // machines that crash on GPU init — the crash loop this whole path exists for.
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'preserves a present-but-unreadable marker',
    () => {
      const markerFile = join(userDataPath, GPU_FALLBACK_MARKER_FILE)
      writeGpuFallbackMarker(
        userDataPath,
        { engagedAt: 1, crashesInWindow: 4, tier: 2 },
        environment
      )
      chmodSync(markerFile, 0o000)
      try {
        const result = readActiveGpuFallbackMarker(userDataPath, environment)
        expect(result.marker).toBeNull()
        expect(result.cleared).toBeNull()
        expect(result.unreadableErrorCode).toBe('EACCES')
        expect(existsSync(markerFile)).toBe(true)
      } finally {
        chmodSync(markerFile, 0o600)
      }
    }
  )

  it('reports a directory-shaped marker as unreadable rather than deleting it', () => {
    const markerFile = join(userDataPath, GPU_FALLBACK_MARKER_FILE)
    mkdirSync(markerFile)
    const result = readActiveGpuFallbackMarker(userDataPath, environment)
    expect(result.marker).toBeNull()
    expect(result.cleared).toBeNull()
    expect(result.unreadableErrorCode).toBe('EISDIR')
    expect(existsSync(markerFile)).toBe(true)
  })

  it('can explicitly clear the marker', () => {
    writeGpuFallbackMarker(userDataPath, { engagedAt: 1, crashesInWindow: 4, tier: 1 }, environment)
    clearGpuFallbackMarker(userDataPath)
    expect(readGpuFallbackMarker(userDataPath)).toBeNull()
  })
})
