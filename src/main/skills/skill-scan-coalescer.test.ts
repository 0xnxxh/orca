import { describe, expect, it } from 'vitest'
import { SkillScanCoalescer } from './skill-scan-coalescer'

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('SkillScanCoalescer', () => {
  it('collapses concurrent callers on one key into a single scan', async () => {
    const coalescer = new SkillScanCoalescer<number>(8)
    const gate = deferred<number>()
    let runs = 0
    const task = (): Promise<number> => {
      runs += 1
      return gate.promise
    }

    const outcomes = Promise.all([
      coalescer.run('root', { ttlMs: 0 }, task),
      coalescer.run('root', { ttlMs: 0 }, task),
      coalescer.run('root', { ttlMs: 0 }, task)
    ])
    gate.resolve(7)

    expect((await outcomes).map((outcome) => outcome.value)).toEqual([7, 7, 7])
    expect((await outcomes).map((outcome) => outcome.source)).toEqual([
      'scanned',
      'joined',
      'joined'
    ])
    expect(runs).toBe(1)
  })

  it('keeps distinct keys isolated, including paths differing only by case', async () => {
    const coalescer = new SkillScanCoalescer<string>(8)
    const seen: string[] = []
    const run = (key: string): Promise<{ value: string }> =>
      coalescer.run(key, { ttlMs: 1_000 }, async () => {
        seen.push(key)
        return key
      })

    const [lower, upper] = await Promise.all([run('/home/a/Skills'), run('/home/a/skills')])

    expect(lower.value).toBe('/home/a/Skills')
    expect(upper.value).toBe('/home/a/skills')
    expect(seen).toHaveLength(2)
  })

  it('reuses a result inside the ttl and rescans after it lapses', async () => {
    let now = 1_000
    const coalescer = new SkillScanCoalescer<number>(8, () => now)
    let runs = 0
    const task = async (): Promise<number> => {
      runs += 1
      return runs
    }

    expect((await coalescer.run('root', { ttlMs: 100 }, task)).source).toBe('scanned')
    now = 1_050
    const cached = await coalescer.run('root', { ttlMs: 100 }, task)
    expect(cached).toEqual({ value: 1, source: 'cached' })
    now = 1_101
    expect(await coalescer.run('root', { ttlMs: 100 }, task)).toEqual({
      value: 2,
      source: 'scanned'
    })
    expect(runs).toBe(2)
  })

  it('retains nothing when the ttl is zero', async () => {
    const coalescer = new SkillScanCoalescer<number>(8)
    let runs = 0
    const task = async (): Promise<number> => {
      runs += 1
      return runs
    }

    await coalescer.run('root', { ttlMs: 0 }, task)
    await coalescer.run('root', { ttlMs: 0 }, task)

    expect(runs).toBe(2)
  })

  it('bypasses cached and in-flight results when refreshing', async () => {
    let now = 1_000
    const coalescer = new SkillScanCoalescer<number>(8, () => now)
    let runs = 0
    const task = async (): Promise<number> => {
      runs += 1
      return runs
    }

    await coalescer.run('root', { ttlMs: 10_000 }, task)
    const refreshed = await coalescer.run('root', { ttlMs: 10_000, refresh: true }, task)

    expect(refreshed).toEqual({ value: 2, source: 'scanned' })
    // The refreshed result is what later readers see, not the entry it replaced.
    expect(await coalescer.run('root', { ttlMs: 10_000 }, task)).toEqual({
      value: 2,
      source: 'cached'
    })
    expect(runs).toBe(2)
  })

  it('does not cache a failed scan', async () => {
    const coalescer = new SkillScanCoalescer<number>(8)
    let runs = 0

    await expect(
      coalescer.run('root', { ttlMs: 10_000 }, async () => {
        runs += 1
        throw new Error('scan failed')
      })
    ).rejects.toThrow('scan failed')
    expect(await coalescer.run('root', { ttlMs: 10_000 }, async () => 5)).toEqual({
      value: 5,
      source: 'scanned'
    })
    expect(runs).toBe(1)
  })

  it('evicts the least recently used entry past the bound', async () => {
    let now = 1_000
    const coalescer = new SkillScanCoalescer<string>(2, () => now)
    const scan = (key: string): Promise<{ source: string }> =>
      coalescer.run(key, { ttlMs: 10_000 }, async () => key)

    await scan('a')
    await scan('b')
    // Reading 'a' promotes it, so 'b' is the eviction candidate when 'c' arrives.
    expect((await scan('a')).source).toBe('cached')
    await scan('c')

    expect((await scan('a')).source).toBe('cached')
    expect((await scan('b')).source).toBe('scanned')
  })

  it('clears everything on demand', async () => {
    const coalescer = new SkillScanCoalescer<number>(8)
    let runs = 0
    const task = async (): Promise<number> => {
      runs += 1
      return runs
    }

    await coalescer.run('root', { ttlMs: 10_000 }, task)
    coalescer.clear()
    await coalescer.run('root', { ttlMs: 10_000 }, task)

    expect(runs).toBe(2)
  })
})
