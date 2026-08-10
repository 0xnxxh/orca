import { realpath } from 'node:fs/promises'
import { posix, win32 } from 'node:path'
import { isWindowsAbsolutePathLike } from '../../shared/cross-platform-path'

function looksLikePosixAbsolutePath(pathValue: string): boolean {
  return pathValue.startsWith('/') && !pathValue.startsWith('//')
}

function usesWindowsPathSemantics(pathValue: string, platform: NodeJS.Platform): boolean {
  return (
    isWindowsAbsolutePathLike(pathValue) ||
    (platform === 'win32' && !looksLikePosixAbsolutePath(pathValue))
  )
}

/** Stable location key with Windows-only separator and case folding. */
export function normalizeComparablePath(pathValue: string, platform = process.platform): string {
  return usesWindowsPathSemantics(pathValue, platform)
    ? pathValue.replace(/\\/g, '/').toLowerCase()
    : pathValue
}

export function normalizeFsPath(pathValue: string, platform = process.platform): string {
  if (usesWindowsPathSemantics(pathValue, platform)) {
    return win32.normalize(win32.resolve(pathValue))
  }
  return posix.normalize(posix.resolve(pathValue))
}

export async function canonicalizeUsagePath(pathValue: string): Promise<string> {
  const isNonNativePath =
    process.platform === 'win32'
      ? looksLikePosixAbsolutePath(pathValue)
      : isWindowsAbsolutePathLike(pathValue)
  if (isNonNativePath) {
    return normalizeFsPath(pathValue)
  }
  try {
    return normalizeFsPath(await realpath(pathValue))
  } catch {
    return normalizeFsPath(pathValue)
  }
}
