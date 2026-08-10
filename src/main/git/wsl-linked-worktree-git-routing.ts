import { readFile, stat } from 'node:fs/promises'
import { win32 } from 'node:path'
import type { Stats } from 'node:fs'

type CachedRoute = { root: string | null; expiresAt: number }

// Bounds stale routing after delete/recreate while amortizing async parent walks on slow storage.
export const WSL_LINKED_WORKTREE_ROUTE_TTL_MS = 30_000

const routeByCwd = new Map<string, CachedRoute>()
const pendingRoutes = new Map<string, Promise<boolean>>()
const hostGitRoots = new Map<string, number>()

export function isWslLinkedWorktreeGitRoutingCandidate(
  cwd: string,
  wslDistro: string | undefined,
  platform: NodeJS.Platform = process.platform
): boolean {
  return platform === 'win32' && Boolean(wslDistro) && /^[A-Za-z]:[/\\]/.test(cwd)
}

function normalize(path: string): string {
  return win32.resolve(path).toLowerCase()
}

function containsPath(root: string, cwd: string): boolean {
  const relative = win32.relative(root, cwd)
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${win32.sep}`) && !win32.isAbsolute(relative))
  )
}

function cachedRoute(cwd: string, now: number): boolean | undefined {
  const exact = routeByCwd.get(cwd)
  let hasFreshExactMiss = false
  if (exact) {
    if (exact.expiresAt > now && exact.root !== null) {
      return true
    }
    if (exact.expiresAt <= now) {
      routeByCwd.delete(cwd)
    } else {
      hasFreshExactMiss = true
    }
  }
  for (const [root, expiresAt] of hostGitRoots) {
    if (expiresAt <= now) {
      hostGitRoots.delete(root)
    } else if (containsPath(root, cwd)) {
      return true
    }
  }
  return hasFreshExactMiss ? false : undefined
}

export function parseWindowsLinkedGitdir(content: string): string | null {
  const firstLine = content.split(/\r?\n/, 1)[0] ?? ''
  return firstLine.match(/^gitdir:\s*([A-Za-z]:[/\\].*?)\s*$/i)?.[1] ?? null
}

export type WslLinkedWorktreeRoutingFileSystem = {
  stat(path: string): Promise<Pick<Stats, 'isDirectory' | 'isFile'>>
  readFile(path: string): Promise<string>
}

const defaultFileSystem: WslLinkedWorktreeRoutingFileSystem = {
  stat,
  readFile: (path) => readFile(path, 'utf8')
}

async function findLinkedWorktreeRoot(
  cwd: string,
  fileSystem: WslLinkedWorktreeRoutingFileSystem
): Promise<string | null> {
  let candidate = cwd
  const driveRoot = win32.parse(candidate).root
  while (true) {
    const markerPath = win32.join(candidate, '.git')
    try {
      const marker = await fileSystem.stat(markerPath)
      if (marker.isDirectory()) {
        return null
      }
      if (marker.isFile()) {
        return parseWindowsLinkedGitdir(await fileSystem.readFile(markerPath)) ? candidate : null
      }
      return null
    } catch (error) {
      const code = error && typeof error === 'object' ? (error as NodeJS.ErrnoException).code : null
      if (code !== 'ENOENT' && code !== 'ENOTDIR') {
        return null
      }
    }
    if (candidate === driveRoot) {
      return null
    }
    candidate = win32.dirname(candidate)
  }
}

function rememberRoute(cwd: string, root: string | null, now: number): boolean {
  const normalizedRoot = root ? normalize(root) : null
  const expiresAt = now + WSL_LINKED_WORKTREE_ROUTE_TTL_MS
  routeByCwd.set(cwd, { root: normalizedRoot, expiresAt })
  if (normalizedRoot) {
    hostGitRoots.set(normalizedRoot, expiresAt)
  }
  return normalizedRoot !== null
}

export async function prepareWslLinkedWorktreeGitRouting(
  cwd: string,
  wslDistro: string | undefined,
  platform: NodeJS.Platform = process.platform,
  fileSystem: WslLinkedWorktreeRoutingFileSystem = defaultFileSystem,
  now: () => number = Date.now
): Promise<boolean> {
  if (!isWslLinkedWorktreeGitRoutingCandidate(cwd, wslDistro, platform)) {
    return false
  }
  const normalizedCwd = normalize(cwd)
  const cached = cachedRoute(normalizedCwd, now())
  if (cached !== undefined) {
    return cached
  }
  const pending = pendingRoutes.get(normalizedCwd)
  if (pending) {
    return pending
  }
  const route = findLinkedWorktreeRoot(normalizedCwd, fileSystem)
    .then((root) => rememberRoute(normalizedCwd, root, now()))
    .finally(() => pendingRoutes.delete(normalizedCwd))
  pendingRoutes.set(normalizedCwd, route)
  return route
}

export function usesHostGitForWslLinkedWorktree(
  cwd: string,
  wslDistro: string | undefined,
  platform: NodeJS.Platform = process.platform,
  now: () => number = Date.now
): boolean {
  return (
    isWslLinkedWorktreeGitRoutingCandidate(cwd, wslDistro, platform) &&
    cachedRoute(normalize(cwd), now()) === true
  )
}

export function resetWslLinkedWorktreeGitRoutingForTests(): void {
  routeByCwd.clear()
  pendingRoutes.clear()
  hostGitRoots.clear()
}

export function seedWslLinkedWorktreeGitRoutingForTests(root: string): void {
  const normalizedRoot = normalize(root)
  routeByCwd.set(normalizedRoot, {
    root: normalizedRoot,
    expiresAt: Number.POSITIVE_INFINITY
  })
  hostGitRoots.set(normalizedRoot, Number.POSITIVE_INFINITY)
}
