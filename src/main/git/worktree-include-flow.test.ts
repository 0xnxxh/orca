import { execFile } from 'node:child_process'
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createWorktreeCopiedPaths } from '../ipc/worktree-symlinks'
import { resolveWorktreeIncludePaths } from './worktree-include-file'

const execFileAsync = promisify(execFile)

describe('worktree include creation flow', () => {
  let root = ''
  let primary = ''
  let worktree = ''

  async function git(args: string[], cwd = primary): Promise<void> {
    await execFileAsync('git', args, { cwd })
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'orca-worktree-include-flow-'))
    primary = join(root, 'primary')
    worktree = join(root, 'feature')
    await mkdir(primary)
    await git(['init', '-q'])
    await git(['config', 'user.email', 'worktree-include@example.invalid'])
    await git(['config', 'user.name', 'Worktree Include Test'])
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('copies only matched ignored paths and leaves ordinary removal clean', async () => {
    await writeFile(join(primary, '.gitignore'), '.env\ncache/\nparent/\n')
    await writeFile(join(primary, '.worktreeinclude'), '.env\ncache/\nbuild/\ntracked.txt\n')
    await writeFile(join(primary, 'tracked.txt'), 'tracked\n')
    await writeFile(join(primary, '.env'), 'ROOT=1\n')
    await mkdir(join(primary, 'apps', 'web'), { recursive: true })
    await writeFile(join(primary, 'apps', 'web', '.env'), 'NESTED=1\n')
    await mkdir(join(primary, 'cache'))
    await writeFile(join(primary, 'cache', 'artifact'), 'cached\n')
    await mkdir(join(primary, 'parent', 'build'), { recursive: true })
    await writeFile(join(primary, 'parent', 'build', 'marker'), 'built\n')
    await git(['add', '.gitignore', '.worktreeinclude', 'tracked.txt'])
    await git(['commit', '-qm', 'initial'])
    await git(['worktree', 'add', '-q', '-b', 'feature', worktree])

    const includePaths = await resolveWorktreeIncludePaths(primary)
    expect(includePaths).toEqual(['.env', 'apps/web/.env', 'cache', 'parent/build/marker'])

    await createWorktreeCopiedPaths(primary, worktree, includePaths, { platform: 'linux' })

    expect(await readFile(join(worktree, '.env'), 'utf8')).toBe('ROOT=1\n')
    expect(await readFile(join(worktree, 'apps', 'web', '.env'), 'utf8')).toBe('NESTED=1\n')
    expect(await readFile(join(worktree, 'cache', 'artifact'), 'utf8')).toBe('cached\n')
    expect(await readFile(join(worktree, 'parent', 'build', 'marker'), 'utf8')).toBe('built\n')
    expect((await lstat(join(worktree, 'tracked.txt'))).isFile()).toBe(true)

    await writeFile(join(worktree, '.env'), 'ROOT=2\n')
    expect(await readFile(join(primary, '.env'), 'utf8')).toBe('ROOT=1\n')
    await git(['worktree', 'remove', worktree])
  })
})
