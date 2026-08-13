import { describe, expect, it, vi } from 'vitest'
import type { GitHistoryExecutor } from './git-history'
import { loadGitHistoryFromExecutor } from './git-history'

function oid(index: number): string {
  return index.toString(16).padStart(40, '0')
}

function logRecord(hash: string, message: string, parents: string[]): string {
  return `${[hash, 'Ada Lovelace', 'ada@example.com', '1700000000', '1700000000', parents.join(' '), '', message].join('\n')}\0`
}

/**
 * Fake of a linear history of `total` commits, newest first, that honours `-n` and the starting
 * revision the way `git log` does — so a cursor request really walks from that commit's position.
 */
function createWalkExecutor(
  total: number,
  { knownOids }: { knownOids?: Set<string> } = {}
): { executor: GitHistoryExecutor; logCalls: string[][] } {
  const chain = Array.from({ length: total }, (_, index) => oid(index))
  const logCalls: string[][] = []

  const executor = vi.fn(async (args: string[]) => {
    const command = args[0]
    if (command === 'rev-parse') {
      const target = args.find((arg) => arg.endsWith('^{commit}'))?.replace('^{commit}', '')
      if (target === 'HEAD') {
        return { stdout: `${chain[0]}\n` }
      }
      // Why: models a cursor that no longer resolves (rebased away, pruned).
      if (target && knownOids && !knownOids.has(target)) {
        throw new Error(`unknown revision ${target}`)
      }
      return target && chain.includes(target) ? { stdout: `${target}\n` } : { stdout: '' }
    }
    if (command === 'symbolic-ref') {
      return { stdout: 'main\n' }
    }
    if (command === 'for-each-ref') {
      return { stdout: '' }
    }
    if (command === 'merge-base') {
      return { stdout: '' }
    }
    if (command === 'log') {
      logCalls.push(args)
      const count = Number(args.find((arg) => arg.startsWith('-n'))?.slice(2) ?? total)
      const start = args.at(-1) ?? ''
      const from = chain.indexOf(start)
      const walk = chain.slice(from === -1 ? 0 : from, (from === -1 ? 0 : from) + count)
      return {
        stdout: walk
          .map((hash) =>
            logRecord(hash, `commit ${chain.indexOf(hash)}`, [chain[chain.indexOf(hash) + 1] ?? ''])
          )
          .join('')
      }
    }
    throw new Error(`unexpected git command: ${args.join(' ')}`)
  })

  return { executor, logCalls }
}

describe('git history cursor paging', () => {
  it('walks from HEAD when no cursor is given', async () => {
    const { executor, logCalls } = createWalkExecutor(200)

    const result = await loadGitHistoryFromExecutor(executor, '/repo', { limit: 50 })

    expect(result.items).toHaveLength(50)
    expect(result.items[0]?.id).toBe(oid(0))
    expect(result.hasMore).toBe(true)
    // one lookahead past the page
    expect(logCalls[0]).toContain('-n51')
  })

  it('resumes after the cursor without repeating it', async () => {
    const { executor, logCalls } = createWalkExecutor(200)

    const page = await loadGitHistoryFromExecutor(executor, '/repo', { limit: 50, cursor: oid(49) })

    expect(page.items[0]?.id).toBe(oid(50))
    expect(page.items.map((item) => item.id)).not.toContain(oid(49))
    expect(page.items).toHaveLength(50)
    // Why: the walk re-emits the cursor, so the page needs one extra beyond the lookahead.
    expect(logCalls[0]).toContain('-n52')
    expect(logCalls[0]?.at(-1)).toBe(oid(49))
  })

  // Why: this is the property the whole design turns on — page cost must not grow with depth.
  it('asks for one page of output no matter how deep paging goes', async () => {
    const { executor, logCalls } = createWalkExecutor(1000)

    for (const cursor of [oid(49), oid(299), oid(899)]) {
      await loadGitHistoryFromExecutor(executor, '/repo', { limit: 50, cursor })
    }

    const requestedCounts = logCalls.map((args) =>
      Number(args.find((arg) => arg.startsWith('-n'))?.slice(2))
    )
    expect(requestedCounts).toEqual([52, 52, 52])
  })

  it('reports no further page at the end of history', async () => {
    const { executor } = createWalkExecutor(60)

    const page = await loadGitHistoryFromExecutor(executor, '/repo', { limit: 50, cursor: oid(49) })

    expect(page.items).toHaveLength(10)
    expect(page.hasMore).toBe(false)
  })

  it('pages past the old 200-commit ceiling', async () => {
    const { executor } = createWalkExecutor(1000)

    const deep = await loadGitHistoryFromExecutor(executor, '/repo', {
      limit: 50,
      cursor: oid(199)
    })

    expect(deep.items[0]?.id).toBe(oid(200))
    expect(deep.hasMore).toBe(true)
  })

  // Why: a cursor can die under a rebase. Degrading to a fresh first page keeps the panel usable;
  // passing the dead revision to `git log` would fail the whole read.
  it('falls back to a fresh first page when the cursor no longer resolves', async () => {
    const { executor, logCalls } = createWalkExecutor(200, {
      knownOids: new Set(Array.from({ length: 200 }, (_, index) => oid(index)).slice(0, 100))
    })

    const page = await loadGitHistoryFromExecutor(executor, '/repo', {
      limit: 50,
      cursor: oid(150)
    })

    expect(page.items[0]?.id).toBe(oid(0))
    expect(logCalls[0]).toContain('-n51')
  })
})
