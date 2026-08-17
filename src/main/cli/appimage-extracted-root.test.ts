import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ensureAppImageExtractedRoot,
  getAppImageCacheRootPath,
  isAppImageExtractionComplete,
  pruneAppImageExtractedRoots,
  resolveAppImageCacheKey,
  resolveAppImageExtractedRoot
} from './appimage-extracted-root'

const created: string[] = []

afterEach(async () => {
  await Promise.all(created.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function makeFixture(): Promise<{
  root: string
  appImagePath: string
  cacheRootPath: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'orca-appimage-extract-'))
  created.push(root)
  const appImagePath = join(root, 'Orca.AppImage')
  await writeFile(appImagePath, '#!/usr/bin/env bash\n', { encoding: 'utf8', mode: 0o755 })
  return { root, appImagePath, cacheRootPath: join(root, 'cache') }
}

/** Stands in for the AppImage runtime, which writes ./squashfs-root under cwd. */
async function writePayload(cwd: string): Promise<void> {
  const launcherDir = join(cwd, 'squashfs-root', 'resources', 'bin')
  await mkdir(launcherDir, { recursive: true })
  await writeFile(join(launcherDir, 'orca-ide'), '', { encoding: 'utf8', mode: 0o755 })
}

describe('appimage extracted root', () => {
  it('derives the cache root from XDG_CACHE_HOME when set', () => {
    const previous = process.env.XDG_CACHE_HOME
    process.env.XDG_CACHE_HOME = '/xdg-cache'
    try {
      expect(getAppImageCacheRootPath('/home/u')).toBe('/xdg-cache/orca/appimage')
    } finally {
      if (previous === undefined) {
        delete process.env.XDG_CACHE_HOME
      } else {
        process.env.XDG_CACHE_HOME = previous
      }
    }
  })

  it('extracts once and reuses the payload on the next call', async () => {
    const { appImagePath, cacheRootPath } = await makeFixture()
    let extractCount = 0
    const runExtract = async (_path: string, cwd: string): Promise<void> => {
      extractCount += 1
      await writePayload(cwd)
    }

    const first = await ensureAppImageExtractedRoot({ appImagePath, cacheRootPath, runExtract })
    const second = await ensureAppImageExtractedRoot({ appImagePath, cacheRootPath, runExtract })

    expect(extractCount).toBe(1)
    expect(second?.launcherPath).toBe(first?.launcherPath)
    expect(isAppImageExtractionComplete(first!)).toBe(true)
  })

  // Why: an update replaces the file in place, so the key must change or the
  // command would keep resolving through the previous version's payload.
  it('keys the payload on size and mtime, not just path', async () => {
    const { appImagePath, cacheRootPath } = await makeFixture()
    const before = resolveAppImageCacheKey(appImagePath)
    await writeFile(appImagePath, '#!/usr/bin/env bash\n# newer\n', {
      encoding: 'utf8',
      mode: 0o755
    })

    expect(resolveAppImageCacheKey(appImagePath)).not.toBe(before)
    expect(resolveAppImageExtractedRoot({ appImagePath, cacheRootPath })?.rootPath).toContain(
      resolveAppImageCacheKey(appImagePath) as string
    )
  })

  // Why: a crashed extraction must not leave a directory that later reads treat
  // as a usable payload — the command would exec a path that does not exist.
  it('publishes nothing when extraction fails partway', async () => {
    const { appImagePath, cacheRootPath } = await makeFixture()

    const result = await ensureAppImageExtractedRoot({
      appImagePath,
      cacheRootPath,
      runExtract: async (_path, cwd) => {
        await mkdir(join(cwd, 'squashfs-root'), { recursive: true })
        throw new Error('extraction interrupted')
      }
    })

    expect(result).toBeNull()
    await expect(readdir(cacheRootPath)).resolves.toEqual([])
  })

  it('reports failure when the payload has no launcher', async () => {
    const { appImagePath, cacheRootPath } = await makeFixture()

    const result = await ensureAppImageExtractedRoot({
      appImagePath,
      cacheRootPath,
      runExtract: async (_path, cwd) => {
        await mkdir(join(cwd, 'squashfs-root'), { recursive: true })
      }
    })

    expect(result).toBeNull()
  })

  it('returns null for an AppImage that is not there', async () => {
    const { root, cacheRootPath } = await makeFixture()
    const missing = join(root, 'Absent.AppImage')

    expect(resolveAppImageCacheKey(missing)).toBeNull()
    expect(resolveAppImageExtractedRoot({ appImagePath: missing, cacheRootPath })).toBeNull()
  })

  it('prunes every payload except the one being kept', async () => {
    const { cacheRootPath } = await makeFixture()
    const keep = join(cacheRootPath, 'keep')
    const stale = join(cacheRootPath, 'stale')
    await mkdir(keep, { recursive: true })
    await mkdir(stale, { recursive: true })

    await pruneAppImageExtractedRoots(keep, cacheRootPath)

    expect(existsSync(keep)).toBe(true)
    expect(existsSync(stale)).toBe(false)
  })

  it('tolerates pruning a cache root that was never created', async () => {
    const { root } = await makeFixture()
    await expect(pruneAppImageExtractedRoots('', join(root, 'never-made'))).resolves.toBeUndefined()
  })
})
