import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveWorktreeSharedDirectories } from './worktree-shared-directories'

const git = (args: string[], cwd: string): void => {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

describe('resolveWorktreeSharedDirectories', () => {
  let repo: string
  let warn: ReturnType<typeof vi.spyOn>

  const writeOrcaYaml = (body: string): void => {
    writeFileSync(join(repo, 'orca.yaml'), body)
  }

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'orca-shared-dirs-'))
    git(['init', '-q'], repo)
    git(['config', 'user.email', 'test@example.com'], repo)
    git(['config', 'user.name', 'Test'], repo)
    writeFileSync(join(repo, '.gitignore'), 'node_modules/\n.cache\n')
    writeFileSync(join(repo, 'README.md'), '# tracked\n')
    git(['add', '.gitignore', 'README.md'], repo)
    git(['commit', '-qm', 'init'], repo)
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warn.mockRestore()
    rmSync(repo, { recursive: true, force: true })
  })

  it('returns gitignored directories listed under worktree.sharedDirectories', async () => {
    mkdirSync(join(repo, 'node_modules'))
    mkdirSync(join(repo, '.cache'))
    writeOrcaYaml('worktree:\n  sharedDirectories:\n    - node_modules\n    - .cache\n')

    expect(await resolveWorktreeSharedDirectories(repo)).toEqual(['.cache', 'node_modules'])
  })

  it('returns [] when orca.yaml is absent', async () => {
    mkdirSync(join(repo, 'node_modules'))

    expect(await resolveWorktreeSharedDirectories(repo)).toEqual([])
  })

  it('returns [] when orca.yaml has no worktree key', async () => {
    mkdirSync(join(repo, 'node_modules'))
    writeOrcaYaml('scripts:\n  setup: pnpm install\n')

    expect(await resolveWorktreeSharedDirectories(repo)).toEqual([])
  })

  it('skips a directory that is not gitignored', async () => {
    mkdirSync(join(repo, 'shared-but-tracked'))
    writeOrcaYaml('worktree:\n  sharedDirectories:\n    - shared-but-tracked\n')

    expect(await resolveWorktreeSharedDirectories(repo)).toEqual([])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('only gitignored directories'))
  })

  it('skips a listed path that is a file, not a directory', async () => {
    writeFileSync(join(repo, '.cache'), 'not a dir')
    writeOrcaYaml('worktree:\n  sharedDirectories:\n    - .cache\n')

    expect(await resolveWorktreeSharedDirectories(repo)).toEqual([])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('must be directories'))
  })

  it('skips entries that are absent from the primary checkout', async () => {
    writeOrcaYaml('worktree:\n  sharedDirectories:\n    - node_modules\n')

    expect(await resolveWorktreeSharedDirectories(repo)).toEqual([])
  })

  it('drops unsafe entries before touching the filesystem', async () => {
    mkdirSync(join(repo, 'node_modules'))
    writeOrcaYaml(
      [
        'worktree:',
        '  sharedDirectories:',
        '    - ../escape',
        '    - /etc',
        '    - .git',
        '    - .git/hooks',
        '    - node_modules',
        ''
      ].join('\n')
    )

    expect(await resolveWorktreeSharedDirectories(repo)).toEqual(['node_modules'])
  })

  it('normalizes trailing slashes, ./ prefixes and duplicates', async () => {
    mkdirSync(join(repo, 'node_modules'))
    writeOrcaYaml(
      'worktree:\n  sharedDirectories:\n    - node_modules/\n    - ./node_modules\n    - node_modules\n'
    )

    expect(await resolveWorktreeSharedDirectories(repo)).toEqual(['node_modules'])
  })

  it('returns [] for a malformed sharedDirectories value instead of throwing', async () => {
    mkdirSync(join(repo, 'node_modules'))
    writeOrcaYaml('worktree:\n  sharedDirectories: node_modules\n')

    expect(await resolveWorktreeSharedDirectories(repo)).toEqual([])
  })

  it('resolves nested directories anchored at the repo root', async () => {
    mkdirSync(join(repo, 'apps', 'web', '.cache'), { recursive: true })
    writeFileSync(join(repo, '.gitignore'), 'node_modules/\n.cache\napps/web/.cache\n')
    writeOrcaYaml('worktree:\n  sharedDirectories:\n    - apps/web/.cache\n')

    expect(await resolveWorktreeSharedDirectories(repo)).toEqual(['apps/web/.cache'])
  })
})
