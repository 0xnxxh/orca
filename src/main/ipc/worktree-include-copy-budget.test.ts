import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createWorktreeCopyBudgetTracker,
  formatWorktreeIncludeCopyWarning
} from './worktree-include-copy-budget'
import { createWorktreeCopiedPaths, createWorktreeLinkedPaths } from './worktree-symlinks'

const posixIt = process.platform === 'win32' ? it.skip : it

// A byte budget small enough to trip on a fixture that stays trivial on disk —
// the bound must be injectable or testing it would mean writing gigabytes.
const TINY_BYTE_BUDGET = { maxBytes: 64, maxEntries: 10_000 }
const TINY_ENTRY_BUDGET = { maxBytes: 1024 * 1024 * 1024, maxEntries: 3 }

describe('worktree copy budget tracker', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'orca-copy-budget-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('admits a source that fits and reports its measured size', async () => {
    writeFileSync(join(root, 'small.env'), 'A=1\n')
    const tracker = createWorktreeCopyBudgetTracker(TINY_BYTE_BUDGET)

    await expect(tracker.admit(join(root, 'small.env'))).resolves.toEqual({
      withinBudget: true,
      bytes: 4,
      entries: 1
    })
  })

  it('refuses a directory whose total bytes exceed the budget', async () => {
    mkdirSync(join(root, 'node_modules'))
    writeFileSync(join(root, 'node_modules', 'a'), 'x'.repeat(40))
    writeFileSync(join(root, 'node_modules', 'b'), 'x'.repeat(40))
    const tracker = createWorktreeCopyBudgetTracker(TINY_BYTE_BUDGET)

    await expect(tracker.admit(join(root, 'node_modules'))).resolves.toEqual({
      withinBudget: false,
      reason: 'bytes'
    })
  })

  it('refuses a directory with too many entries even when it weighs nothing', async () => {
    mkdirSync(join(root, 'cache'))
    for (const name of ['a', 'b', 'c', 'd', 'e']) {
      writeFileSync(join(root, 'cache', name), '')
    }
    const tracker = createWorktreeCopyBudgetTracker(TINY_ENTRY_BUDGET)

    await expect(tracker.admit(join(root, 'cache'))).resolves.toEqual({
      withinBudget: false,
      reason: 'entries'
    })
  })

  it('spends one budget across every admitted source', async () => {
    writeFileSync(join(root, 'first'), 'x'.repeat(40))
    writeFileSync(join(root, 'second'), 'x'.repeat(40))
    const tracker = createWorktreeCopyBudgetTracker(TINY_BYTE_BUDGET)

    await expect(tracker.admit(join(root, 'first'))).resolves.toMatchObject({ withinBudget: true })
    await expect(tracker.admit(join(root, 'second'))).resolves.toEqual({
      withinBudget: false,
      reason: 'bytes'
    })
  })

  it('does not spend budget on a refused source, so a later small one still fits', async () => {
    writeFileSync(join(root, 'big'), 'x'.repeat(200))
    writeFileSync(join(root, 'small'), 'A=1\n')
    const tracker = createWorktreeCopyBudgetTracker(TINY_BYTE_BUDGET)

    await expect(tracker.admit(join(root, 'big'))).resolves.toEqual({
      withinBudget: false,
      reason: 'bytes'
    })
    await expect(tracker.admit(join(root, 'small'))).resolves.toMatchObject({ withinBudget: true })
  })

  it('ignores the byte limit when the backend copies on write, but still counts entries', async () => {
    writeFileSync(join(root, 'huge'), 'x'.repeat(400))
    const tracker = createWorktreeCopyBudgetTracker(TINY_BYTE_BUDGET)

    await expect(
      tracker.admit(join(root, 'huge'), { bytesAreCopied: false })
    ).resolves.toMatchObject({ withinBudget: true })

    // The same source is refused once its bytes actually have to be written.
    const byteTracker = createWorktreeCopyBudgetTracker(TINY_BYTE_BUDGET)
    await expect(byteTracker.admit(join(root, 'huge'))).resolves.toEqual({
      withinBudget: false,
      reason: 'bytes'
    })
  })

  it('charges the walk itself so repeated over-budget sources cannot re-walk forever', async () => {
    for (const dir of ['a', 'b']) {
      mkdirSync(join(root, dir))
      writeFileSync(join(root, dir, 'one'), 'x'.repeat(200))
    }
    writeFileSync(join(root, 'tiny'), '')
    // Each refused source walks 2 entries before busting the byte limit, so the
    // two of them exhaust a 4-entry ceiling.
    const tracker = createWorktreeCopyBudgetTracker({ maxBytes: 64, maxEntries: 4 })

    await expect(tracker.admit(join(root, 'a'))).resolves.toMatchObject({ withinBudget: false })
    await expect(tracker.admit(join(root, 'b'))).resolves.toMatchObject({ withinBudget: false })

    // Neither was admitted, so the copy budget itself is untouched and `tiny`
    // would fit — it is refused purely because the walk ceiling is spent.
    await expect(tracker.admit(join(root, 'tiny'))).resolves.toEqual({
      withinBudget: false,
      reason: 'entries'
    })
  })

  posixIt('counts a nested symlink without following it', async () => {
    mkdirSync(join(root, 'payload'))
    writeFileSync(join(root, 'payload', 'real'), 'x'.repeat(40))
    mkdirSync(join(root, 'dir'))
    // Following this would re-count `payload` and blow the byte budget.
    symlinkSync(join(root, 'payload'), join(root, 'dir', 'alias'))
    const tracker = createWorktreeCopyBudgetTracker(TINY_BYTE_BUDGET)

    await expect(tracker.admit(join(root, 'dir'))).resolves.toMatchObject({ withinBudget: true })
  })
})

describe('formatWorktreeIncludeCopyWarning', () => {
  it('is undefined when nothing was skipped', () => {
    expect(formatWorktreeIncludeCopyWarning([])).toBeUndefined()
  })

  it('names every skipped entry so the omission is not silent', () => {
    const warning = formatWorktreeIncludeCopyWarning([
      { path: 'node_modules', reason: 'bytes' },
      { path: '.cache', reason: 'entries' }
    ])

    expect(warning).toContain('"node_modules"')
    expect(warning).toContain('".cache"')
    expect(warning).toContain('.worktreeinclude')
  })
})

describe('createWorktreeCopiedPaths copy budget', () => {
  let root: string
  let primary: string
  let worktree: string
  let warn: ReturnType<typeof vi.spyOn>
  let error: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'orca-copy-budget-paths-'))
    primary = join(root, 'primary')
    worktree = join(root, 'worktree')
    mkdirSync(primary, { recursive: true })
    mkdirSync(worktree, { recursive: true })
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    error = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    warn.mockRestore()
    error.mockRestore()
    rmSync(root, { recursive: true, force: true })
  })

  it('refuses an over-budget directory before writing anything into the worktree', async () => {
    mkdirSync(join(primary, 'node_modules'))
    writeFileSync(join(primary, 'node_modules', 'pkg.js'), 'x'.repeat(200))

    const skipped = await createWorktreeCopiedPaths(primary, worktree, ['node_modules'], {
      platform: 'linux',
      copyBudget: TINY_BYTE_BUDGET
    })

    expect(skipped).toEqual([{ path: 'node_modules', reason: 'bytes' }])
    expect(existsSync(join(worktree, 'node_modules'))).toBe(false)
  })

  it('refuses an entry that busts the file-count limit', async () => {
    mkdirSync(join(primary, '.cache'))
    for (const name of ['a', 'b', 'c', 'd', 'e']) {
      writeFileSync(join(primary, '.cache', name), '')
    }

    const skipped = await createWorktreeCopiedPaths(primary, worktree, ['.cache'], {
      platform: 'linux',
      copyBudget: TINY_ENTRY_BUDGET
    })

    expect(skipped).toEqual([{ path: '.cache', reason: 'entries' }])
    expect(existsSync(join(worktree, '.cache'))).toBe(false)
  })

  it('still copies the entries that fit alongside one that does not', async () => {
    writeFileSync(join(primary, '.env'), 'A=1\n')
    mkdirSync(join(primary, 'node_modules'))
    writeFileSync(join(primary, 'node_modules', 'pkg.js'), 'x'.repeat(200))

    const skipped = await createWorktreeCopiedPaths(primary, worktree, ['node_modules', '.env'], {
      platform: 'linux',
      copyBudget: TINY_BYTE_BUDGET
    })

    expect(skipped).toEqual([{ path: 'node_modules', reason: 'bytes' }])
    expect(readFileSync(join(worktree, '.env'), 'utf8')).toBe('A=1\n')
  })

  it('copies a normal small include fully and reports nothing skipped', async () => {
    writeFileSync(join(primary, '.env'), 'A=1\n')
    mkdirSync(join(primary, '.vscode'))
    writeFileSync(join(primary, '.vscode', 'settings.json'), '{}')

    const skipped = await createWorktreeCopiedPaths(primary, worktree, ['.env', '.vscode'], {
      platform: 'linux'
    })

    expect(skipped).toEqual([])
    expect(readFileSync(join(worktree, '.env'), 'utf8')).toBe('A=1\n')
    expect(readFileSync(join(worktree, '.vscode', 'settings.json'), 'utf8')).toBe('{}')
  })

  it('still clones on macOS when only the byte budget would be exceeded', async () => {
    mkdirSync(join(primary, 'node_modules'))
    writeFileSync(join(primary, 'node_modules', 'pkg.js'), 'x'.repeat(200))
    const cloneWorktreePath = vi.fn(async () => undefined)

    const skipped = await createWorktreeCopiedPaths(primary, worktree, ['node_modules'], {
      platform: 'darwin',
      cloneWorktreePath,
      copyBudget: TINY_BYTE_BUDGET
    })

    // An APFS clone is copy-on-write: bytes cost nothing, so refusing on bytes
    // would deny a copy that is already free.
    expect(skipped).toEqual([])
    expect(cloneWorktreePath).toHaveBeenCalledTimes(1)
  })

  it('does not run the macOS APFS clone for an entry over the file-count limit', async () => {
    mkdirSync(join(primary, '.cache'))
    for (const name of ['a', 'b', 'c', 'd', 'e']) {
      writeFileSync(join(primary, '.cache', name), '')
    }
    const cloneWorktreePath = vi.fn(async () => undefined)

    const skipped = await createWorktreeCopiedPaths(primary, worktree, ['.cache'], {
      platform: 'darwin',
      cloneWorktreePath,
      copyBudget: TINY_ENTRY_BUDGET
    })

    // Inodes are real work even on the clone path, so the entry limit holds.
    expect(skipped).toEqual([{ path: '.cache', reason: 'entries' }])
    expect(cloneWorktreePath).not.toHaveBeenCalled()
  })

  posixIt('leaves link mode unbounded — symlinks cost no bytes', async () => {
    mkdirSync(join(primary, 'node_modules'))
    writeFileSync(join(primary, 'node_modules', 'pkg.js'), 'x'.repeat(200))

    await createWorktreeLinkedPaths(primary, worktree, ['node_modules'], {
      platform: 'linux',
      copyBudget: TINY_BYTE_BUDGET
    })

    expect(existsSync(join(worktree, 'node_modules', 'pkg.js'))).toBe(true)
  })
})
