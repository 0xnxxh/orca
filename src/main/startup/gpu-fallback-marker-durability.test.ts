import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import type * as NodeFsModule from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GPU_FALLBACK_MARKER_FILE, writeGpuFallbackMarker } from './gpu-fallback-marker'

/**
 * The marker is written by a process Chromium may FATAL milliseconds later, and both callers
 * drop the crash history the instant the write returns. A bare writeFileSync could therefore
 * leave a torn marker (discarded as corrupt on the next launch) with the evidence already
 * gone — neither artifact survives and the machine is back in the unbootable loop.
 */

const calls = vi.hoisted(() => [] as string[])
const failRenameOnto = vi.hoisted(() => ({ path: null as string | null }))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFsModule>()
  const writeFileSync = (...args: Parameters<typeof actual.writeFileSync>): void => {
    calls.push(`write:${String(args[0])}`)
    actual.writeFileSync(...args)
  }
  const fsyncSync = (...args: Parameters<typeof actual.fsyncSync>): void => {
    calls.push('fsync')
    actual.fsyncSync(...args)
  }
  const renameSync = (...args: Parameters<typeof actual.renameSync>): void => {
    calls.push(`rename:${String(args[1])}`)
    if (failRenameOnto.path !== null && args[1] === failRenameOnto.path) {
      throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
    }
    actual.renameSync(...args)
  }
  return {
    ...actual,
    default: { ...actual, writeFileSync, fsyncSync, renameSync },
    writeFileSync,
    fsyncSync,
    renameSync
  }
})

const ENVIRONMENT = {
  appVersion: '1.4.184',
  electronVersion: '43.1.0',
  platform: 'win32' as const
}

describe('gpu-fallback marker durability', () => {
  let userDataPath: string
  let markerPath: string

  beforeEach(() => {
    userDataPath = mkdtempSync(join(os.tmpdir(), 'orca-gpu-marker-durable-'))
    markerPath = join(userDataPath, GPU_FALLBACK_MARKER_FILE)
    calls.length = 0
    failRenameOnto.path = null
  })

  afterEach(() => {
    failRenameOnto.path = null
    rmSync(userDataPath, { recursive: true, force: true })
  })

  it('fsyncs a temp file and renames it onto the marker, never writing the marker in place', () => {
    writeGpuFallbackMarker(
      userDataPath,
      { engagedAt: 1_760_000_000_000, crashesInWindow: 3 },
      ENVIRONMENT
    )

    expect(calls).not.toContain(`write:${markerPath}`)
    const tempWrite = calls.findIndex((call) => call.startsWith(`write:${markerPath}.`))
    const rename = calls.indexOf(`rename:${markerPath}`)
    expect(tempWrite).toBeGreaterThanOrEqual(0)
    expect(rename).toBeGreaterThan(tempWrite)
    expect(calls.slice(tempWrite, rename)).toContain('fsync')
    expect(readdirSync(userDataPath)).toEqual([GPU_FALLBACK_MARKER_FILE])
  })

  // Why: the temp name carries the pid, so a failure that left one behind would accumulate
  // orphans under distinct names forever on the machine that retries this write every launch.
  it('cleans up its temp file when the publishing rename fails', () => {
    failRenameOnto.path = markerPath

    expect(() =>
      writeGpuFallbackMarker(userDataPath, { engagedAt: 1, crashesInWindow: 3 }, ENVIRONMENT)
    ).toThrow()
    expect(readdirSync(userDataPath)).toEqual([])
  })
})
