import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseWorktreeIncludePatterns, resolveWorktreeIncludePaths } from './worktree-include-file'
import { gitExecFileAsync } from './runner'

vi.mock('./runner', () => ({
  gitExecFileAsync: vi.fn()
}))

const gitExecFileAsyncMock = vi.mocked(gitExecFileAsync)

/** Dispatch on subcommand: ls-files returns `entries`; check-ignore echoes back
 *  every stdin path present in `ignored`. */
function mockGit(options: { entries?: string[]; ignored?: string[] }): void {
  gitExecFileAsyncMock.mockImplementation(async (args, execOptions) => {
    if (args.includes('ls-files')) {
      return { stdout: (options.entries ?? []).map((entry) => `${entry}\0`).join(''), stderr: '' }
    }
    if (args.includes('check-ignore')) {
      const requested = (execOptions.stdin ?? '').split('\0').filter(Boolean)
      const ignored = new Set(options.ignored ?? requested)
      const matched = requested.filter((path) => ignored.has(path))
      if (matched.length === 0) {
        throw Object.assign(new Error('no matches'), { code: 1 })
      }
      return { stdout: matched.map((path) => `${path}\0`).join(''), stderr: '' }
    }
    throw new Error(`Unexpected git args: ${args.join(' ')}`)
  })
}

describe('parseWorktreeIncludePatterns', () => {
  it('skips blank lines and comments', () => {
    const patterns = parseWorktreeIncludePatterns('# secrets\n\n.env\n  \n# more\n.env.local\n')
    expect(patterns.map((pattern) => pattern.body)).toEqual(['.env', '.env.local'])
  })

  it('parses negation, anchoring, and dir-only markers', () => {
    const [negated, anchored, dirOnly, bare] = parseWorktreeIncludePatterns(
      '!.env.production\n/config/secrets.json\n.vscode/\nbuild\n'
    )
    expect(negated).toMatchObject({ negated: true, body: '.env.production', anchored: false })
    expect(anchored).toMatchObject({ negated: false, body: 'config/secrets.json', anchored: true })
    expect(dirOnly).toMatchObject({ dirOnly: true, body: '.vscode', anchored: false })
    expect(bare).toMatchObject({ dirOnly: false, anchored: false, hasGlob: false })
  })

  it('marks glob patterns and compiles their matcher', () => {
    const [glob] = parseWorktreeIncludePatterns('.env.*\n')
    expect(glob.hasGlob).toBe(true)
    expect(glob.regExp?.test('.env.local')).toBe(true)
    expect(glob.regExp?.test('.envrc')).toBe(false)
  })
})

describe('resolveWorktreeIncludePaths', () => {
  let repo: string

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'orca-worktreeinclude-'))
    gitExecFileAsyncMock.mockReset()
  })

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true })
  })

  function writeInclude(content: string): void {
    writeFileSync(join(repo, '.worktreeinclude'), content)
  }

  it('returns [] without spawning git when the file is absent', async () => {
    await expect(resolveWorktreeIncludePaths(repo)).resolves.toEqual([])
    expect(gitExecFileAsyncMock).not.toHaveBeenCalled()
  })

  it('resolves literal patterns to existing gitignored paths', async () => {
    writeInclude('.env\nconfig/secrets.json\nmissing.txt\n')
    writeFileSync(join(repo, '.env'), 'A=1')
    mkdirSync(join(repo, 'config'))
    writeFileSync(join(repo, 'config', 'secrets.json'), '{}')
    mockGit({ ignored: ['.env', 'config/secrets.json'] })

    await expect(resolveWorktreeIncludePaths(repo)).resolves.toEqual([
      '.env',
      'config/secrets.json'
    ])
    // Literal-only files never pay for a full gitignored enumeration.
    expect(gitExecFileAsyncMock.mock.calls.every(([args]) => !args.includes('ls-files'))).toBe(true)
  })

  it('drops listed paths that are not actually gitignored', async () => {
    writeInclude('.env\ntracked.json\n')
    writeFileSync(join(repo, '.env'), 'A=1')
    writeFileSync(join(repo, 'tracked.json'), '{}')
    mockGit({ ignored: ['.env'] })

    await expect(resolveWorktreeIncludePaths(repo)).resolves.toEqual(['.env'])
  })

  it('expands glob patterns against collapsed gitignored entries', async () => {
    writeInclude('.env.*\n')
    mockGit({
      entries: ['.env.local', '.env.production', '.envrc', 'node_modules/', 'apps/web/.env.local'],
      ignored: ['.env.local', '.env.production', 'apps/web/.env.local']
    })

    // Unanchored patterns match by basename at any depth, like gitignore.
    await expect(resolveWorktreeIncludePaths(repo)).resolves.toEqual([
      '.env.local',
      '.env.production',
      'apps/web/.env.local'
    ])
  })

  it('honors dir-only patterns against directory entries', async () => {
    writeInclude('logs/\n')
    writeFileSync(join(repo, 'logs'), 'not a dir')
    mockGit({ ignored: [] })

    await expect(resolveWorktreeIncludePaths(repo)).resolves.toEqual([])
    rmSync(join(repo, 'logs'))
    mkdirSync(join(repo, 'logs'))
    mockGit({ ignored: ['logs'] })
    await expect(resolveWorktreeIncludePaths(repo)).resolves.toEqual(['logs'])
  })

  it('applies negations with last-match-wins semantics', async () => {
    writeInclude('.env.*\n!.env.production\n')
    mockGit({
      entries: ['.env.local', '.env.production'],
      ignored: ['.env.local', '.env.production']
    })

    await expect(resolveWorktreeIncludePaths(repo)).resolves.toEqual(['.env.local'])
  })

  it('rejects traversal, absolute, and .git patterns', async () => {
    writeInclude('../outside\n/etc/passwd\n.git/config\n.env\n')
    writeFileSync(join(repo, '.env'), 'A=1')
    mockGit({ ignored: ['.env'] })

    await expect(resolveWorktreeIncludePaths(repo)).resolves.toEqual(['.env'])
  })

  it('resolves to [] when git fails instead of throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    writeInclude('.env\n')
    writeFileSync(join(repo, '.env'), 'A=1')
    gitExecFileAsyncMock.mockRejectedValue(new Error('git exploded'))

    await expect(resolveWorktreeIncludePaths(repo)).resolves.toEqual([])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
