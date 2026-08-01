import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import type * as FsPromises from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Why: freezes #42/#43/#33. writeSecureFile ran ~6 sync syscalls on the Electron
// main thread; a stalled ~/.orca mount froze the app while saving a credential.
const { syncFsCalls, asyncFsOps, hangWrites, failWrites } = vi.hoisted(() => ({
  syncFsCalls: [] as string[],
  asyncFsOps: [] as { op: string; path: string; mode?: number }[],
  hangWrites: { value: false },
  failWrites: { value: false }
}))

vi.mock('node:fs', async () => {
  const actual = (await vi.importActual('node:fs')) as Record<string, unknown>
  const wrapped: Record<string, unknown> = { ...actual }
  for (const [name, value] of Object.entries(actual)) {
    if (name.endsWith('Sync') && typeof value === 'function') {
      wrapped[name] = (...args: unknown[]) => {
        syncFsCalls.push(`${name}:${String(args[0])}`)
        return (value as (...a: unknown[]) => unknown)(...args)
      }
    }
  }
  return { ...wrapped, default: wrapped }
})

vi.mock('node:fs/promises', async () => {
  const actual = (await vi.importActual('node:fs/promises')) as typeof FsPromises
  const wrapped: Record<string, unknown> = { ...actual }
  for (const name of ['mkdir', 'writeFile', 'chmod', 'rename', 'rm', 'stat'] as const) {
    const original = actual[name] as (...a: unknown[]) => Promise<unknown>
    wrapped[name] = (...args: unknown[]) => {
      const options = args[2] ?? args[1]
      asyncFsOps.push({
        op: name,
        path: String(args[0]),
        mode:
          typeof options === 'object' && options !== null && 'mode' in options
            ? (options as { mode?: number }).mode
            : undefined
      })
      if (hangWrites.value && name !== 'stat') {
        return new Promise<never>(() => {})
      }
      if (failWrites.value && name === 'writeFile') {
        return Promise.reject(Object.assign(new Error('EACCES'), { code: 'EACCES' }))
      }
      return original(...args)
    }
  }
  return { ...wrapped, default: wrapped }
})

import {
  __resetSecureFileHardenedPathsForTests,
  removeSecureFileAsync,
  writeSecureFileAsync,
  writeSecureJsonFileAsync
} from './secure-file'

const isWindows = process.platform === 'win32'

describe('writeSecureFileAsync', () => {
  let rootDir: string
  let targetPath: string

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), 'orca-secure-file-async-'))
    targetPath = join(rootDir, 'nested', 'credential.enc')
    syncFsCalls.length = 0
    asyncFsOps.length = 0
    hangWrites.value = false
    failWrites.value = false
    __resetSecureFileHardenedPathsForTests()
  })

  afterEach(() => {
    hangWrites.value = false
    failWrites.value = false
    rmSync(rootDir, { recursive: true, force: true })
  })

  it('writes a credential without a single synchronous fs syscall', async () => {
    await writeSecureFileAsync(targetPath, 'secret-token')
    const recorded = [...syncFsCalls]

    expect(recorded).toEqual([])
    expect(readFileSync(targetPath, 'utf-8')).toBe('secret-token')
  })

  it('creates the temp file already mode 0600 and only renames after restricting it', async () => {
    await writeSecureFileAsync(targetPath, 'secret-token')

    const write = asyncFsOps.findIndex((entry) => entry.op === 'writeFile')
    const renameIndex = asyncFsOps.findIndex((entry) => entry.op === 'rename')
    const tmpPath = asyncFsOps[write]?.path ?? ''

    // Why: mode on the CREATE — the credential must never exist world-readable, even briefly.
    expect(asyncFsOps[write]?.mode).toBe(0o600)
    expect(tmpPath.endsWith('.tmp')).toBe(true)
    expect(write).toBeLessThan(renameIndex)
    if (!isWindows) {
      const restrictTmp = asyncFsOps.findIndex(
        (entry) => entry.op === 'chmod' && entry.path === tmpPath
      )
      expect(write).toBeLessThan(restrictTmp)
      expect(restrictTmp).toBeLessThan(renameIndex)
      expect(statSync(targetPath).mode & 0o777).toBe(0o600)
      expect(statSync(join(rootDir, 'nested')).mode & 0o777).toBe(0o700)
    }
  })

  it('serializes overlapping writes so renames never land out of order', async () => {
    const first = writeSecureFileAsync(targetPath, 'first')
    const second = writeSecureJsonFileAsync(targetPath, { value: 'second' })
    await Promise.all([first, second])
    const recorded = [...syncFsCalls]

    const renames = asyncFsOps.filter((entry) => entry.op === 'rename')
    const writes = asyncFsOps.filter((entry) => entry.op === 'writeFile')
    expect(renames).toHaveLength(2)
    // The second write must not start before the first one has published.
    expect(asyncFsOps.indexOf(writes[1]!)).toBeGreaterThan(asyncFsOps.indexOf(renames[0]!))
    expect(JSON.parse(readFileSync(targetPath, 'utf-8'))).toEqual({ value: 'second' })
    expect(recorded).toEqual([])
  })

  // A bare rm() would unlink before the queued write's rename (four awaits later) republished
  // the file, so clearing a credential during an in-flight save was a silent no-op.
  it('serializes a removal after a queued write so the clear cannot be overwritten', async () => {
    const write = writeSecureFileAsync(targetPath, 'secret-token')
    const remove = removeSecureFileAsync(targetPath)
    await Promise.all([write, remove])
    const recorded = [...syncFsCalls]

    const renameIndex = asyncFsOps.findIndex((entry) => entry.op === 'rename')
    const unlinkIndex = asyncFsOps.findIndex(
      (entry) => entry.op === 'rm' && entry.path === targetPath
    )
    expect(renameIndex).toBeGreaterThanOrEqual(0)
    expect(unlinkIndex).toBeGreaterThan(renameIndex)
    expect(existsSync(targetPath)).toBe(false)
    expect(recorded).toEqual([])
  })

  it('keeps the event loop alive while the credential write hangs', async () => {
    hangWrites.value = true
    const pending = writeSecureFileAsync(targetPath, 'secret-token')
    void pending.catch(() => {})

    let timerFired = false
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        timerFired = true
        resolve()
      }, 10)
    })

    expect(timerFired).toBe(true)
    expect(syncFsCalls).toEqual([])
  })

  it('removes the temp file when the write fails and never publishes it', async () => {
    failWrites.value = true

    await expect(writeSecureFileAsync(targetPath, 'secret-token')).rejects.toThrow(/EACCES/)

    const tmpPath = asyncFsOps.find((entry) => entry.op === 'writeFile')?.path
    expect(asyncFsOps).toContainEqual(expect.objectContaining({ op: 'rm', path: tmpPath }))
    expect(asyncFsOps.some((entry) => entry.op === 'rename')).toBe(false)
    expect(syncFsCalls).toEqual([])
  })
})
