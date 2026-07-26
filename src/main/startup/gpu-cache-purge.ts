import { existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Chromium GPU/shader caches under userData.
 *
 * A cache written by the driver that just CHECK-crashed is replayed on the next
 * GPU init, so escalating the fallback tier without purging can reproduce the
 * same crash on a launch that should have been safe.
 */
export const GPU_CACHE_DIRECTORY_NAMES = [
  'GPUCache',
  'ShaderCache',
  'GrShaderCache',
  'DawnCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache'
] as const

export type GpuCachePurgeResult = {
  removed: string[]
  failed: string[]
}

/** Chromium repeats the same cache directories under every persisted session partition. */
const PARTITIONS_DIRECTORY_NAME = 'Partitions'

function partitionCacheRoots(userDataPath: string): { label: string; path: string }[] {
  const partitionsRoot = join(userDataPath, PARTITIONS_DIRECTORY_NAME)
  try {
    return readdirSync(partitionsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        label: `${PARTITIONS_DIRECTORY_NAME}/${entry.name}`,
        path: join(partitionsRoot, entry.name)
      }))
  } catch {
    // No partitions directory (or unreadable): nothing extra to purge.
    return []
  }
}

/** Best effort: a locked cache directory must never block the relaunch that follows. */
export function purgeGpuCaches(userDataPath: string): GpuCachePurgeResult {
  const removed: string[] = []
  const failed: string[] = []
  // Why: Orca's embedded browser uses persist: partitions, each with its own GPUCache;
  // leaving those behind replays a shader written by the driver that just crashed.
  const roots = [{ label: '', path: userDataPath }, ...partitionCacheRoots(userDataPath)]
  for (const root of roots) {
    for (const name of GPU_CACHE_DIRECTORY_NAMES) {
      const target = join(root.path, name)
      const label = root.label ? `${root.label}/${name}` : name
      try {
        if (!existsSync(target)) {
          continue
        }
        // Why: Windows can hold a brief lock on a cache file the dying GPU child owned.
        rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 })
        removed.push(label)
      } catch {
        failed.push(label)
      }
    }
  }
  return { removed, failed }
}
