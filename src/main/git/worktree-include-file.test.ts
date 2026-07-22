import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveWorktreeIncludePaths } from './worktree-include-file'
import {
  compileWorktreeIncludeGlob,
  getWorktreeIncludeGlobStepCount,
  matchesWorktreeIncludeGlob
} from './worktree-include-glob'
import {
  isIncludedByWorktreePatterns,
  parseWorktreeIncludePatterns
} from './worktree-include-pattern'
import { gitExecFileAsync } from './runner'

vi.mock('./runner', () => ({
  gitExecFileAsync: vi.fn()
}))

const gitExecFileAsyncMock = vi.mocked(gitExecFileAsync)

/** Dispatch on subcommand: check-ignore echoes every stdin path present in `ignored`. */
function mockGit(options: {
  entries?: string[]
  collapsedEntries?: string[]
  targetedEntries?: string[]
  ignored?: string[]
  ignoreCase?: boolean
}): void {
  gitExecFileAsyncMock.mockImplementation(async (args, execOptions) => {
    if (args.includes('config')) {
      if (options.ignoreCase === undefined) {
        throw Object.assign(new Error('unset'), { code: 1 })
      }
      return { stdout: `${options.ignoreCase}\n`, stderr: '' }
    }
    if (args.includes('ls-files')) {
      const entries = args.includes('--directory')
        ? (options.collapsedEntries ?? options.entries ?? [])
        : (options.targetedEntries ?? options.entries ?? [])
      return { stdout: entries.map((entry) => `${entry}\0`).join(''), stderr: '' }
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
    expect(glob.glob && matchesWorktreeIncludeGlob(glob.glob, '.env.local')).toBe(true)
    expect(glob.glob && matchesWorktreeIncludeGlob(glob.glob, '.envrc')).toBe(false)
  })

  it('matches repeated recursive globs without regex backtracking', () => {
    const [glob] = parseWorktreeIncludePatterns(`${'**/'.repeat(30)}secrets.json\n`)
    const longNonMatch = `${'nested/'.repeat(500)}other.json`

    expect(glob.glob?.regExp).toBeNull()
    expect(glob.glob && matchesWorktreeIncludeGlob(glob.glob, 'secrets.json')).toBe(true)
    expect(
      glob.glob && matchesWorktreeIncludeGlob(glob.glob, `${'nested/'.repeat(500)}secrets.json`)
    ).toBe(true)
    expect(glob.glob && matchesWorktreeIncludeGlob(glob.glob, longNonMatch)).toBe(false)
  })

  it('matches literals and globs case-insensitively when the repository requires it', () => {
    const literal = parseWorktreeIncludePatterns('.env\n')
    const glob = parseWorktreeIncludePatterns('config/**/secret.json\n')

    expect(isIncludedByWorktreePatterns(literal, '.ENV', false, { remaining: 100 }, true)).toBe(
      true
    )
    expect(
      isIncludedByWorktreePatterns(
        glob,
        'CONFIG/LOCAL/SECRET.JSON',
        false,
        { remaining: 1_000 },
        true
      )
    ).toBe(true)
  })

  it('charges variable-width regex backtracking against the literal suffix', () => {
    const glob = compileWorktreeIncludeGlob(`*${'a'.repeat(1_000)}`)

    expect(getWorktreeIncludeGlobStepCount(glob, 'short')).toBe(6_006)
    expect(getWorktreeIncludeGlobStepCount(compileWorktreeIncludeGlob('prefix*'), 'short')).toBe(12)
  })

  it('charges directory-only rules that reject a root file before glob evaluation', () => {
    const patterns = parseWorktreeIncludePatterns('dir-*/\n')

    expect(() =>
      isIncludedByWorktreePatterns(patterns, 'root-file', false, { remaining: 1 })
    ).toThrow('matching exceeded its CPU budget')
  })

  it('rejects pathological pattern counts before worktree creation can fan out', () => {
    expect(() => parseWorktreeIncludePatterns(`${'.env\n'.repeat(4_097)}`)).toThrow(
      'contains too many patterns'
    )
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
    mockGit({ entries: ['.env'], ignored: ['.env', 'config/secrets.json'] })

    await expect(resolveWorktreeIncludePaths(repo)).resolves.toEqual([
      '.env',
      'config/secrets.json'
    ])
    expect(gitExecFileAsyncMock.mock.calls.some(([args]) => args.includes('ls-files'))).toBe(true)
  })

  it('resolves bare literal patterns at any depth', async () => {
    writeInclude('.env\n')
    writeFileSync(join(repo, '.env'), 'ROOT=1')
    mockGit({ entries: ['.env', 'apps/web/.env'], ignored: ['.env', 'apps/web/.env'] })

    await expect(resolveWorktreeIncludePaths(repo)).resolves.toEqual(['.env', 'apps/web/.env'])
    const lsFilesCalls = gitExecFileAsyncMock.mock.calls.filter(([args]) =>
      args.includes('ls-files')
    )
    expect(lsFilesCalls).toHaveLength(2)
    expect(lsFilesCalls[0][0]).toContain('--directory')
    expect(lsFilesCalls[1][0]).not.toContain('--directory')
    expect(lsFilesCalls[1][0]).toContain(':(glob)**/.env')
  })

  it('routes every Git probe through the selected WSL runtime', async () => {
    writeInclude('/cache/\n.env\n')
    mkdirSync(join(repo, 'cache'))
    mockGit({ collapsedEntries: ['cache/', '.env'], targetedEntries: ['.env'] })

    await expect(resolveWorktreeIncludePaths(repo, { wslDistro: 'Ubuntu' })).resolves.toEqual([
      '.env',
      'cache'
    ])

    expect(gitExecFileAsyncMock).toHaveBeenCalledTimes(4)
    expect(
      gitExecFileAsyncMock.mock.calls.every(([, options]) => options.wslDistro === 'Ubuntu')
    ).toBe(true)
  })

  it('avoids enumeration for a fully ignored root-anchored directory', async () => {
    writeInclude('/cache/\n')
    mkdirSync(join(repo, 'cache'))
    mockGit({ ignored: ['cache'] })

    await expect(resolveWorktreeIncludePaths(repo)).resolves.toEqual(['cache'])
    expect(gitExecFileAsyncMock.mock.calls.every(([args]) => !args.includes('ls-files'))).toBe(true)
  })

  it('removes child candidates when an ignored directory covers them', async () => {
    writeInclude('/ignored/child\n/ignored/\n')
    mkdirSync(join(repo, 'ignored'))
    writeFileSync(join(repo, 'ignored', 'child'), 'local')
    mockGit({ ignored: ['ignored', 'ignored/child'] })

    await expect(resolveWorktreeIncludePaths(repo)).resolves.toEqual(['ignored'])
  })

  it('finds ignored descendants when a root-anchored directory is not itself ignored', async () => {
    writeInclude('/config/\n')
    mkdirSync(join(repo, 'config'))
    mockGit({ targetedEntries: ['config/local.json'], ignored: ['config/local.json'] })

    await expect(resolveWorktreeIncludePaths(repo)).resolves.toEqual(['config/local.json'])
    const targetedArgs = gitExecFileAsyncMock.mock.calls.find(
      ([args]) => args.includes('ls-files') && !args.includes('--directory')
    )?.[0]
    expect(targetedArgs).toContain(':(glob)config/**')
  })

  it('drops listed paths that are not actually gitignored', async () => {
    writeInclude('.env\ntracked.json\n')
    writeFileSync(join(repo, '.env'), 'A=1')
    writeFileSync(join(repo, 'tracked.json'), '{}')
    mockGit({ entries: ['.env'], ignored: ['.env'] })

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

  it('uses Git case-folding for collapsed and targeted matches', async () => {
    writeInclude('.env\n')
    mockGit({
      collapsedEntries: ['.ENV'],
      targetedEntries: ['parent/.ENV'],
      ignored: ['.ENV', 'parent/.ENV'],
      ignoreCase: true
    })

    await expect(resolveWorktreeIncludePaths(repo)).resolves.toEqual(['.ENV', 'parent/.ENV'])
    const targetedArgs = gitExecFileAsyncMock.mock.calls.find(
      ([args]) => args.includes('ls-files') && !args.includes('--directory')
    )?.[0]
    expect(targetedArgs).toContain(':(icase,glob)**/.env')
  })

  it('honors dir-only patterns against directory entries', async () => {
    writeInclude('logs/\n')
    writeFileSync(join(repo, 'logs'), 'not a dir')
    mockGit({ ignored: [] })

    await expect(resolveWorktreeIncludePaths(repo)).resolves.toEqual([])
    rmSync(join(repo, 'logs'))
    mkdirSync(join(repo, 'logs'))
    mockGit({ collapsedEntries: ['logs/'], ignored: ['logs'] })
    await expect(resolveWorktreeIncludePaths(repo)).resolves.toEqual(['logs'])
  })

  it('finds a matching directory beneath a collapsed ignored parent', async () => {
    writeInclude('build/\n')
    mockGit({
      collapsedEntries: ['parent/'],
      targetedEntries: ['parent/build/marker'],
      ignored: ['parent/build/marker']
    })

    await expect(resolveWorktreeIncludePaths(repo)).resolves.toEqual(['parent/build/marker'])
    const targetedArgs = gitExecFileAsyncMock.mock.calls.find(
      ([args]) => args.includes('ls-files') && !args.includes('--directory')
    )?.[0]
    expect(targetedArgs).toContain(':(glob)**/build/**')
  })

  it('does not expand a matched directory during the targeted scan', async () => {
    writeInclude('node_modules/\n')
    mockGit({ collapsedEntries: ['node_modules/'], ignored: ['node_modules'] })

    await expect(resolveWorktreeIncludePaths(repo)).resolves.toEqual(['node_modules'])
    const targetedArgs = gitExecFileAsyncMock.mock.calls.find(
      ([args]) => args.includes('ls-files') && !args.includes('--directory')
    )?.[0]
    expect(targetedArgs).toContain(':(glob)**/node_modules/**')
    expect(targetedArgs).toContain(':(exclude,literal)node_modules')
  })

  it('preserves nested matches when covered-directory exclusions exceed the command budget', async () => {
    writeInclude('covered-*/\n.env\n')
    const coveredDirectories = Array.from(
      { length: 500 },
      (_, index) => `covered-${index.toString().padStart(4, '0')}`
    )
    mockGit({
      collapsedEntries: coveredDirectories.map((path) => `${path}/`),
      targetedEntries: ['hidden/.env']
    })

    const resolved = await resolveWorktreeIncludePaths(repo)

    expect(resolved).toContain('hidden/.env')
    const targetedArgs = gitExecFileAsyncMock.mock.calls.find(
      ([args]) => args.includes('ls-files') && !args.includes('--directory')
    )?.[0]
    expect(targetedArgs).toContain(':(glob)**/.env')
    expect(targetedArgs?.some((arg) => arg.startsWith(':(exclude,literal)'))).toBe(false)
  })

  it('does not let an unignored literal parent hide an ignored nested match', async () => {
    writeInclude('/config\n.env\n')
    mkdirSync(join(repo, 'config'))
    mockGit({ entries: ['config/.env'], ignored: ['config/.env'] })

    await expect(resolveWorktreeIncludePaths(repo)).resolves.toEqual(['config/.env'])
  })

  it('bounds the number of paths that can reach copy materialization', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    writeInclude('*\n')
    mockGit({
      collapsedEntries: Array.from({ length: 10_001 }, (_, index) => `ignored-${index}`)
    })

    await expect(resolveWorktreeIncludePaths(repo)).resolves.toEqual([])
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to resolve'),
      expect.objectContaining({ message: expect.stringContaining('matched too many paths') })
    )
    expect(gitExecFileAsyncMock.mock.calls.some(([args]) => args.includes('check-ignore'))).toBe(
      false
    )
    warn.mockRestore()
  })

  it('stops enumeration as soon as candidate paths exceed the byte budget', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    writeInclude('*\n')
    mockGit({
      collapsedEntries: Array.from(
        { length: 100 },
        (_, index) => `ignored-${index}-${'a'.repeat(11_000)}`
      ),
      targetedEntries: []
    })

    await expect(resolveWorktreeIncludePaths(repo)).resolves.toEqual([])
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to resolve'),
      expect.objectContaining({ message: expect.stringContaining('byte budget') })
    )
    expect(
      gitExecFileAsyncMock.mock.calls.filter(([args]) => args.includes('ls-files'))
    ).toHaveLength(1)
    warn.mockRestore()
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
    mockGit({ entries: ['.env'], ignored: ['.env'] })

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
