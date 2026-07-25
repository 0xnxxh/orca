import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GPU_CACHE_DIRECTORY_NAMES, purgeGpuCaches } from './gpu-cache-purge'

describe('purgeGpuCaches', () => {
  let userDataPath: string

  beforeEach(() => {
    userDataPath = mkdtempSync(join(os.tmpdir(), 'orca-gpu-cache-purge-test-'))
  })

  afterEach(() => {
    rmSync(userDataPath, { recursive: true, force: true })
  })

  it('removes populated GPU cache directories', () => {
    for (const name of GPU_CACHE_DIRECTORY_NAMES) {
      mkdirSync(join(userDataPath, name, 'nested'), { recursive: true })
      writeFileSync(join(userDataPath, name, 'nested', 'entry.bin'), 'shader')
    }

    const result = purgeGpuCaches(userDataPath)

    expect(result.removed).toEqual([...GPU_CACHE_DIRECTORY_NAMES])
    expect(result.failed).toEqual([])
    for (const name of GPU_CACHE_DIRECTORY_NAMES) {
      expect(existsSync(join(userDataPath, name))).toBe(false)
    }
  })

  it('reports nothing removed when no caches exist', () => {
    expect(purgeGpuCaches(userDataPath)).toEqual({ removed: [], failed: [] })
  })

  it('leaves unrelated userData entries alone', () => {
    mkdirSync(join(userDataPath, 'GPUCache'), { recursive: true })
    writeFileSync(join(userDataPath, 'orca-data.json'), '{}')

    purgeGpuCaches(userDataPath)

    expect(existsSync(join(userDataPath, 'orca-data.json'))).toBe(true)
  })

  // Why: this runs on the path to a relaunch — a missing userData dir must not throw.
  it('does not throw for a missing userData directory', () => {
    expect(() => purgeGpuCaches(join(userDataPath, 'absent'))).not.toThrow()
  })
})
