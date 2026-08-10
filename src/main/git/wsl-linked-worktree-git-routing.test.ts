import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  parseWindowsLinkedGitdir,
  prepareWslLinkedWorktreeGitRouting,
  resetWslLinkedWorktreeGitRoutingForTests,
  seedWslLinkedWorktreeGitRoutingForTests,
  usesHostGitForWslLinkedWorktree,
  WSL_LINKED_WORKTREE_ROUTE_TTL_MS,
  type WslLinkedWorktreeRoutingFileSystem
} from './wsl-linked-worktree-git-routing'

afterEach(() => resetWslLinkedWorktreeGitRoutingForTests())

const fileMarker = { isDirectory: () => false, isFile: () => true }
const directoryMarker = { isDirectory: () => true, isFile: () => false }

function missingMarker(): NodeJS.ErrnoException {
  return Object.assign(new Error('missing'), { code: 'ENOENT' })
}

describe('parseWindowsLinkedGitdir', () => {
  it.each([
    ['gitdir: C:/repo/.git/worktrees/linked\n', 'C:/repo/.git/worktrees/linked'],
    [String.raw`gitdir: D:\repo\.git\worktrees\linked`, String.raw`D:\repo\.git\worktrees\linked`]
  ])('accepts a Windows drive-qualified gitdir', (content, expected) => {
    expect(parseWindowsLinkedGitdir(content)).toBe(expected)
  })

  it.each([
    'gitdir: ../main/.git/worktrees/linked',
    'gitdir: /home/dev/repo/.git/worktrees/linked',
    'gitdir: C:repo/.git/worktrees/linked',
    'not a gitdir'
  ])('rejects the non-Windows-linked marker %s', (content) => {
    expect(parseWindowsLinkedGitdir(content)).toBeNull()
  })
})

describe('usesHostGitForWslLinkedWorktree', () => {
  it('scopes a cached route to the linked root and its folder workspaces', () => {
    seedWslLinkedWorktreeGitRoutingForTests(String.raw`C:\repo\linked`)

    expect(
      usesHostGitForWslLinkedWorktree(String.raw`C:\repo\linked\packages\app`, 'Ubuntu', 'win32')
    ).toBe(true)
    expect(usesHostGitForWslLinkedWorktree(String.raw`C:\repo\main`, 'Ubuntu', 'win32')).toBe(false)
  })

  it('treats a child named ..data as inside the linked root', () => {
    seedWslLinkedWorktreeGitRoutingForTests(String.raw`C:\repo\linked`)

    expect(
      usesHostGitForWslLinkedWorktree(String.raw`C:\repo\linked\..data`, 'Ubuntu', 'win32')
    ).toBe(true)
    expect(
      usesHostGitForWslLinkedWorktree(String.raw`C:\repo\linked-sibling`, 'Ubuntu', 'win32')
    ).toBe(false)
  })

  it('does not affect native Windows, WSL-native, or non-Windows execution', () => {
    seedWslLinkedWorktreeGitRoutingForTests(String.raw`C:\repo\linked`)

    expect(usesHostGitForWslLinkedWorktree(String.raw`C:\repo\linked`, undefined, 'win32')).toBe(
      false
    )
    expect(
      usesHostGitForWslLinkedWorktree(
        '\\\\wsl.localhost\\Ubuntu\\home\\dev\\repo',
        'Ubuntu',
        'win32'
      )
    ).toBe(false)
    expect(usesHostGitForWslLinkedWorktree(String.raw`C:\repo\linked`, 'Ubuntu', 'linux')).toBe(
      false
    )
  })
})

describe('prepareWslLinkedWorktreeGitRouting', () => {
  it('discovers a parent marker asynchronously and caches its folder tree', async () => {
    const fileSystem: WslLinkedWorktreeRoutingFileSystem = {
      stat: vi.fn(async (path) => {
        if (path === String.raw`c:\repo\.git`) {
          return fileMarker
        }
        throw missingMarker()
      }),
      readFile: vi.fn(async () => 'gitdir: C:/main/.git/worktrees/linked\n')
    }

    await expect(
      prepareWslLinkedWorktreeGitRouting(
        String.raw`C:\repo\packages\app`,
        'Ubuntu',
        'win32',
        fileSystem
      )
    ).resolves.toBe(true)
    await expect(
      prepareWslLinkedWorktreeGitRouting(
        String.raw`C:\repo\packages\other`,
        'Ubuntu',
        'win32',
        fileSystem
      )
    ).resolves.toBe(true)
    expect(fileSystem.stat).toHaveBeenCalledTimes(3)
    expect(fileSystem.readFile).toHaveBeenCalledTimes(1)
  })

  it('caches an ordinary repository marker without reading it', async () => {
    const fileSystem: WslLinkedWorktreeRoutingFileSystem = {
      stat: vi.fn(async () => directoryMarker),
      readFile: vi.fn(async () => '')
    }

    await expect(
      prepareWslLinkedWorktreeGitRouting(String.raw`C:\repo`, 'Ubuntu', 'win32', fileSystem)
    ).resolves.toBe(false)
    await expect(
      prepareWslLinkedWorktreeGitRouting(String.raw`C:\repo`, 'Ubuntu', 'win32', fileSystem)
    ).resolves.toBe(false)
    expect(fileSystem.stat).toHaveBeenCalledTimes(1)
    expect(fileSystem.readFile).not.toHaveBeenCalled()
  })

  it('revalidates a linked route that becomes an ordinary repository', async () => {
    let linked = true
    let currentTime = 1_000
    const now = (): number => currentTime
    const fileSystem: WslLinkedWorktreeRoutingFileSystem = {
      stat: vi.fn(async () => (linked ? fileMarker : directoryMarker)),
      readFile: vi.fn(async () => 'gitdir: C:/main/.git/worktrees/linked\n')
    }

    await expect(
      prepareWslLinkedWorktreeGitRouting(String.raw`C:\repo`, 'Ubuntu', 'win32', fileSystem, now)
    ).resolves.toBe(true)
    linked = false
    currentTime += WSL_LINKED_WORKTREE_ROUTE_TTL_MS - 1
    await expect(
      prepareWslLinkedWorktreeGitRouting(String.raw`C:\repo`, 'Ubuntu', 'win32', fileSystem, now)
    ).resolves.toBe(true)
    expect(fileSystem.stat).toHaveBeenCalledTimes(1)

    currentTime += 1
    await expect(
      prepareWslLinkedWorktreeGitRouting(String.raw`C:\repo`, 'Ubuntu', 'win32', fileSystem, now)
    ).resolves.toBe(false)
    expect(usesHostGitForWslLinkedWorktree(String.raw`C:\repo`, 'Ubuntu', 'win32', now)).toBe(false)
    expect(fileSystem.stat).toHaveBeenCalledTimes(2)
    expect(fileSystem.readFile).toHaveBeenCalledTimes(1)
  })

  it('revalidates an ordinary repository that becomes a linked worktree', async () => {
    let linked = false
    let currentTime = 1_000
    const now = (): number => currentTime
    const fileSystem: WslLinkedWorktreeRoutingFileSystem = {
      stat: vi.fn(async () => (linked ? fileMarker : directoryMarker)),
      readFile: vi.fn(async () => 'gitdir: C:/main/.git/worktrees/linked\n')
    }

    await expect(
      prepareWslLinkedWorktreeGitRouting(String.raw`C:\repo`, 'Ubuntu', 'win32', fileSystem, now)
    ).resolves.toBe(false)
    linked = true
    currentTime += WSL_LINKED_WORKTREE_ROUTE_TTL_MS - 1
    await expect(
      prepareWslLinkedWorktreeGitRouting(String.raw`C:\repo`, 'Ubuntu', 'win32', fileSystem, now)
    ).resolves.toBe(false)
    expect(fileSystem.stat).toHaveBeenCalledTimes(1)

    currentTime += 1
    await expect(
      prepareWslLinkedWorktreeGitRouting(String.raw`C:\repo`, 'Ubuntu', 'win32', fileSystem, now)
    ).resolves.toBe(true)
    expect(usesHostGitForWslLinkedWorktree(String.raw`C:\repo`, 'Ubuntu', 'win32', now)).toBe(true)
    expect(fileSystem.stat).toHaveBeenCalledTimes(2)
    expect(fileSystem.readFile).toHaveBeenCalledTimes(1)
  })

  it('lets a revalidated linked parent supersede an unexpired child miss', async () => {
    let linked = false
    const fileSystem: WslLinkedWorktreeRoutingFileSystem = {
      stat: vi.fn(async (path) => {
        if (path === String.raw`c:\repo\.git`) {
          return linked ? fileMarker : directoryMarker
        }
        throw missingMarker()
      }),
      readFile: vi.fn(async () => 'gitdir: C:/main/.git/worktrees/linked\n')
    }

    await expect(
      prepareWslLinkedWorktreeGitRouting(
        String.raw`C:\repo\packages\app`,
        'Ubuntu',
        'win32',
        fileSystem
      )
    ).resolves.toBe(false)
    linked = true
    await expect(
      prepareWslLinkedWorktreeGitRouting(
        String.raw`C:\repo\packages\other`,
        'Ubuntu',
        'win32',
        fileSystem
      )
    ).resolves.toBe(true)
    await expect(
      prepareWslLinkedWorktreeGitRouting(
        String.raw`C:\repo\packages\app`,
        'Ubuntu',
        'win32',
        fileSystem
      )
    ).resolves.toBe(true)
    expect(fileSystem.stat).toHaveBeenCalledTimes(6)
  })

  it('coalesces delayed discovery without blocking an event-loop turn', async () => {
    let releaseStat: ((marker: typeof fileMarker) => void) | undefined
    const delayedStat = new Promise<typeof fileMarker>((resolve) => {
      releaseStat = resolve
    })
    const fileSystem: WslLinkedWorktreeRoutingFileSystem = {
      stat: vi.fn(() => delayedStat),
      readFile: vi.fn(async () => 'gitdir: C:/main/.git/worktrees/linked\n')
    }
    let settled = false

    const first = prepareWslLinkedWorktreeGitRouting(
      String.raw`C:\repo`,
      'Ubuntu',
      'win32',
      fileSystem
    ).finally(() => {
      settled = true
    })
    const second = prepareWslLinkedWorktreeGitRouting(
      String.raw`C:\repo`,
      'Ubuntu',
      'win32',
      fileSystem
    )
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(settled).toBe(false)
    expect(fileSystem.stat).toHaveBeenCalledTimes(1)
    releaseStat?.(fileMarker)
    await expect(Promise.all([first, second])).resolves.toEqual([true, true])
    expect(fileSystem.readFile).toHaveBeenCalledTimes(1)
  })

  it('coalesces concurrent revalidation after a cached route expires', async () => {
    let currentTime = 1_000
    const now = (): number => currentTime
    let releaseStat: ((marker: typeof fileMarker) => void) | undefined
    const delayedStat = new Promise<typeof fileMarker>((resolve) => {
      releaseStat = resolve
    })
    const fileSystem: WslLinkedWorktreeRoutingFileSystem = {
      stat: vi.fn().mockResolvedValueOnce(directoryMarker).mockReturnValueOnce(delayedStat),
      readFile: vi.fn(async () => 'gitdir: C:/main/.git/worktrees/linked\n')
    }

    await expect(
      prepareWslLinkedWorktreeGitRouting(String.raw`C:\repo`, 'Ubuntu', 'win32', fileSystem, now)
    ).resolves.toBe(false)
    currentTime += WSL_LINKED_WORKTREE_ROUTE_TTL_MS

    const first = prepareWslLinkedWorktreeGitRouting(
      String.raw`C:\repo`,
      'Ubuntu',
      'win32',
      fileSystem,
      now
    )
    const second = prepareWslLinkedWorktreeGitRouting(
      String.raw`C:\repo`,
      'Ubuntu',
      'win32',
      fileSystem,
      now
    )

    expect(fileSystem.stat).toHaveBeenCalledTimes(2)
    releaseStat?.(fileMarker)
    await expect(Promise.all([first, second])).resolves.toEqual([true, true])
    expect(fileSystem.stat).toHaveBeenCalledTimes(2)
    expect(fileSystem.readFile).toHaveBeenCalledTimes(1)
  })
})
