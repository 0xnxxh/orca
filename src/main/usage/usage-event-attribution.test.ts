import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  attributeUsageEvent,
  canonicalizeUsageAttributionWorktrees,
  type UsageAttributionWorktree
} from './usage-event-attribution'
import {
  canonicalizeUsagePath,
  normalizeComparablePath,
  normalizeFsPath
} from './usage-path-comparison'

const TIMESTAMP = '2026-04-09T10:00:00.000Z'
const tempDirectories: string[] = []

function event(cwd: string | null, timestamp = TIMESTAMP) {
  return {
    sessionId: 'session-1',
    timestamp,
    cwd,
    eventKey: 'event-1',
    hasInferredPricing: false,
    estimatedCostUsd: 0.01
  }
}

function worktree(path: string, displayName = 'Repo'): UsageAttributionWorktree {
  return {
    repoId: 'repo-1',
    worktreeId: `repo-1::${path}`,
    path,
    displayName,
    canonicalPath: path
  }
}

describe('usage event attribution', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    for (const directory of tempDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('canonicalizes roots longest-first and attributes nested paths to the nearest worktree', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'orca-usage-attribution-'))
    const appPath = join(repoPath, 'packages', 'app')
    mkdirSync(appPath, { recursive: true })
    tempDirectories.push(repoPath)
    const worktrees = await canonicalizeUsageAttributionWorktrees([
      worktree(repoPath, 'Repo'),
      worktree(appPath, 'App')
    ])

    const attributed = attributeUsageEvent(event(join(realpathSync(appPath), 'src')), worktrees)

    expect(worktrees.map((entry) => entry.displayName)).toEqual(['App', 'Repo'])
    expect(attributed).toMatchObject({
      projectKey: `worktree:repo-1::${appPath}`,
      projectLabel: 'App',
      repoId: 'repo-1',
      worktreeId: `repo-1::${appPath}`,
      eventKey: 'event-1',
      hasInferredPricing: false,
      estimatedCostUsd: 0.01
    })
  })

  it('distinguishes dotdot-prefixed children from parent escapes', () => {
    const worktrees = [worktree('/workspace/repo')]

    expect(
      attributeUsageEvent(event('/workspace/repo/..fixtures/session'), worktrees)
    ).toMatchObject({
      projectKey: 'worktree:repo-1::/workspace/repo',
      worktreeId: 'repo-1::/workspace/repo'
    })
    expect(attributeUsageEvent(event('/workspace/repo/../other/session'), worktrees)).toMatchObject(
      {
        projectKey: 'cwd:/workspace/repo/../other/session',
        projectLabel: 'other/session',
        worktreeId: null
      }
    )
  })

  it('does not confuse sibling paths that share a prefix', () => {
    const worktrees = [
      worktree('/workspace/repo/app', 'App'),
      worktree('/workspace/repo/app2', 'App 2')
    ]

    expect(attributeUsageEvent(event('/workspace/repo/app2/subdir'), worktrees)?.projectLabel).toBe(
      'App 2'
    )
  })

  it('uses Win32 containment for Windows-shaped paths on every host', () => {
    const worktrees = [worktree('C:\\Repo')]

    expect(attributeUsageEvent(event('c:\\repo\\src'), worktrees)?.worktreeId).toBe(
      'repo-1::C:\\Repo'
    )
    expect(attributeUsageEvent(event('D:\\other\\repo'), worktrees)).toMatchObject({
      projectKey: 'cwd:d:/other/repo',
      worktreeId: null
    })

    const uncWorktrees = [worktree('\\\\server\\share\\repo')]
    expect(
      attributeUsageEvent(event('\\\\server\\share\\repo\\src'), uncWorktrees)?.worktreeId
    ).toBe('repo-1::\\\\server\\share\\repo')
    expect(attributeUsageEvent(event('\\\\server\\other\\repo'), uncWorktrees)).toMatchObject({
      projectKey: 'cwd://server/other/repo',
      worktreeId: null
    })

    const forwardUncWorktrees = [worktree('//SERVER/Share/Repo')]
    expect(
      attributeUsageEvent(event('//server/share/repo/src'), forwardUncWorktrees)?.worktreeId
    ).toBe('repo-1:://SERVER/Share/Repo')
  })

  it('keeps POSIX paths case-sensitive on Windows hosts', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const worktrees = await canonicalizeUsageAttributionWorktrees([worktree('/home/dev/Repo')])

    expect(attributeUsageEvent(event('/home/dev/Repo/src'), worktrees)?.worktreeId).toBe(
      'repo-1::/home/dev/Repo'
    )
    expect(attributeUsageEvent(event('/home/dev/repo/src'), worktrees)?.worktreeId).toBeNull()
  })

  it.skipIf(process.platform === 'win32')(
    'does not resolve non-native Windows paths through the host filesystem',
    async () => {
      const nativePath = mkdtempSync(join(tmpdir(), 'orca-usage-unc-'))
      tempDirectories.push(nativePath)
      const forwardUncPath = `/${nativePath}`

      expect(await canonicalizeUsagePath(forwardUncPath)).toBe(normalizeFsPath(forwardUncPath))
    }
  )

  it('preserves POSIX backslashes while folding Windows separators', () => {
    expect(normalizeComparablePath('team\\repo', 'linux')).toBe('team\\repo')
    expect(normalizeComparablePath('team\\repo', 'win32')).toBe('team/repo')
  })

  it('uses local calendar days and safe unscoped defaults', () => {
    const localTimestamp = new Date(2026, 3, 4, 23, 30).toISOString()

    expect(attributeUsageEvent(event(null, localTimestamp), [])).toMatchObject({
      day: '2026-04-04',
      projectKey: 'unscoped',
      projectLabel: 'Unknown location',
      repoId: null,
      worktreeId: null
    })
    expect(attributeUsageEvent(event('/outside/repo'), [])).toMatchObject({
      projectKey: 'cwd:/outside/repo',
      projectLabel: 'outside/repo'
    })
    expect(attributeUsageEvent(event(null, 'invalid'), [])).toBeNull()
  })
})
