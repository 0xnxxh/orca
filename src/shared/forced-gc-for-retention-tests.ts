import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'

/** Resolve forced GC under plain Vitest; hardened runtimes may return null. */
export function resolveForcedGc(): (() => void) | null {
  const existing = (globalThis as { gc?: () => void }).gc
  if (typeof existing === 'function') {
    return existing
  }
  try {
    setFlagsFromString('--expose-gc')
    try {
      const exposed = runInNewContext('gc') as unknown
      return typeof exposed === 'function' ? (exposed as () => void) : null
    } finally {
      setFlagsFromString('--no-expose-gc')
    }
  } catch {
    return null
  }
}

/** Collect twice so freshly unreachable parents are released. */
export function createForceGc(gc: () => void): () => void {
  return () => {
    gc()
    gc()
  }
}
