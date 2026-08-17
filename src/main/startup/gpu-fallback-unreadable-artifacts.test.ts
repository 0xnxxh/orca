import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import type * as NodeFsModule from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GPU_CRASH_HISTORY_FILE,
  countStartupGpuCrashLaunches,
  forgetGpuCrashLaunch,
  readActiveGpuCrashHistory,
  recordGpuCrashInHistory
} from './gpu-crash-history'
import {
  GPU_FALLBACK_MARKER_FILE,
  readActiveGpuFallbackMarker,
  readGpuFallbackMarkerState,
  writeGpuFallbackMarker
} from './gpu-fallback-marker'

/**
 * Both durable artifacts are read on the pre-whenReady decision path and on the crash path,
 * where a read can fail for reasons that say nothing about the contents: on Windows, Defender
 * scanning the file the publishing rename just created returns a sharing violation
 * (EBUSY/EACCES). Treating that as corruption and deleting the file resets the distinct-launch
 * counter on exactly the machine the cross-launch rescue exists to rescue.
 */

const unreadablePaths = vi.hoisted(() => new Set<string>())

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFsModule>()
  const readFileSync = (
    ...args: Parameters<typeof actual.readFileSync>
  ): ReturnType<typeof actual.readFileSync> => {
    if (typeof args[0] === 'string' && unreadablePaths.has(args[0])) {
      throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' })
    }
    return actual.readFileSync(...args)
  }
  return { ...actual, default: { ...actual, readFileSync }, readFileSync }
})

const ENVIRONMENT = {
  appVersion: '1.4.184',
  electronVersion: '43.1.0',
  platform: 'win32' as const
}

const NOW = 1_760_000_000_000

describe('GPU fallback artifacts that cannot be read', () => {
  let userDataPath: string

  beforeEach(() => {
    userDataPath = mkdtempSync(join(os.tmpdir(), 'orca-gpu-unreadable-'))
    unreadablePaths.clear()
  })

  afterEach(() => {
    unreadablePaths.clear()
    rmSync(userDataPath, { recursive: true, force: true })
  })

  it('keeps a crash history it could not read, and the launches it counts', () => {
    for (const launchId of ['launch-0', 'launch-1']) {
      recordGpuCrashInHistory(
        userDataPath,
        { atEpochMs: NOW, msSinceLaunch: 581, launchId },
        ENVIRONMENT
      )
    }
    const path = join(userDataPath, GPU_CRASH_HISTORY_FILE)
    const intact = readFileSync(path, 'utf-8')
    unreadablePaths.add(path)

    expect(readActiveGpuCrashHistory(userDataPath, ENVIRONMENT)).toEqual([])
    // Why: publishing a one-entry file over evidence it could not read erases it just as surely.
    recordGpuCrashInHistory(
      userDataPath,
      { atEpochMs: NOW + 1_000, msSinceLaunch: 581, launchId: 'launch-2' },
      ENVIRONMENT
    )
    forgetGpuCrashLaunch(userDataPath, 'launch-0')
    unreadablePaths.clear()

    expect(readFileSync(path, 'utf-8')).toBe(intact)
    expect(
      countStartupGpuCrashLaunches(readActiveGpuCrashHistory(userDataPath, ENVIRONMENT), NOW)
    ).toBe(2)
  })

  // Why: deleting a marker this process merely failed to open restores the hardware launch the
  // machine already proved it cannot survive — silently, with no evidence left to re-derive it.
  it('keeps a marker it could not read', () => {
    writeGpuFallbackMarker(userDataPath, { engagedAt: NOW, crashesInWindow: 3 }, ENVIRONMENT)
    const path = join(userDataPath, GPU_FALLBACK_MARKER_FILE)
    const intact = readFileSync(path, 'utf-8')
    unreadablePaths.add(path)

    expect(readActiveGpuFallbackMarker(userDataPath, ENVIRONMENT, NOW)).toBeNull()
    unreadablePaths.clear()

    expect(readFileSync(path, 'utf-8')).toBe(intact)
    expect(readGpuFallbackMarkerState(userDataPath, ENVIRONMENT, NOW).active?.crashesInWindow).toBe(
      3
    )
  })

  it('still discards a file that really is corrupt', () => {
    writeFileSync(join(userDataPath, GPU_CRASH_HISTORY_FILE), '{ "crashes": [')
    writeFileSync(join(userDataPath, GPU_FALLBACK_MARKER_FILE), '{ not json')

    expect(readActiveGpuCrashHistory(userDataPath, ENVIRONMENT)).toEqual([])
    expect(readActiveGpuFallbackMarker(userDataPath, ENVIRONMENT, NOW)).toBeNull()
    expect(() => readFileSync(join(userDataPath, GPU_CRASH_HISTORY_FILE), 'utf-8')).toThrow()
    expect(() => readFileSync(join(userDataPath, GPU_FALLBACK_MARKER_FILE), 'utf-8')).toThrow()
  })
})
