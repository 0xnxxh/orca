// The unlimited-depth regression: at the old 4096-entry cap a corpus of ~14k
// transcripts cycled the LRU ~3.5x per scan, so every entry was evicted by the
// same scan that wrote it and the next scan re-parsed the whole corpus
// (reused=0, ~8.8 GB, 40 s of main-thread work, repeatedly).
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createSessionParseStats,
  MAX_CACHE_ENTRIES,
  parseAgentSessionFileCached,
  resetSessionParseCacheForTests,
  seedSessionParseCache,
  type PersistedSessionParseCacheEntry
} from './session-scanner-parse-cache'
import type { FileWithMtime, SessionFileCandidate } from './session-scanner-types'

// Comfortably past the old cap, small enough to write and parse twice quickly.
const CORPUS_SIZE = 4200

let tempRoot: string | null = null

beforeEach(() => {
  resetSessionParseCacheForTests()
})

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true })
    tempRoot = null
  }
})

function transcriptBody(index: number): string {
  const sessionId = `aaaaaaaa-bbbb-4ccc-8ddd-${String(index).padStart(12, '0')}`
  return `${JSON.stringify({
    type: 'user',
    sessionId,
    timestamp: new Date(1740000000000 + index * 60_000).toISOString(),
    cwd: '/repo/app',
    gitBranch: 'main',
    message: { role: 'user', content: `question ${index}` }
  })}\n`
}

async function candidateFor(path: string): Promise<SessionFileCandidate> {
  const fileStat = await stat(path)
  const file: FileWithMtime = {
    path,
    mtimeMs: fileStat.mtimeMs,
    modifiedAt: fileStat.mtime.toISOString(),
    sizeBytes: fileStat.size
  }
  return { agent: 'claude', file, codexHome: null }
}

describe('parse cache over an unlimited-depth corpus', () => {
  it('reuses every entry on the second pass over a corpus larger than the old cap', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'orca-parse-cache-corpus-'))
    const dir = join(tempRoot, 'projects')
    await mkdir(dir, { recursive: true })
    const paths = Array.from({ length: CORPUS_SIZE }, (_, index) =>
      join(dir, `session-${index}.jsonl`)
    )
    await Promise.all(paths.map((path, index) => writeFile(path, transcriptBody(index))))
    const candidates = await Promise.all(paths.map(candidateFor))

    const cold = createSessionParseStats()
    for (const candidate of candidates) {
      await parseAgentSessionFileCached(candidate, process.platform, cold)
    }
    expect(cold.fullParses).toBe(CORPUS_SIZE)

    const warm = createSessionParseStats()
    for (const candidate of candidates) {
      await parseAgentSessionFileCached(candidate, process.platform, warm)
    }
    expect(warm.reused).toBe(CORPUS_SIZE)
    expect(warm.fullParses).toBe(0)
    expect(warm.incremental).toBe(0)
    expect(warm.bytesRead).toBe(0)
    // ~0.7s alone, but 8400 real file reads contend with the rest of the suite.
  }, 60_000)

  // The cliff the raised cap alone did not remove: eviction used to drop the LRU
  // head, and a scan sweeps candidates newest→oldest, so each store discarded
  // precisely the entry the next sweep reached first. One file past the cap took
  // reuse to exactly 0 — the same failure the cap raise was meant to fix, just
  // relocated. A full cache must now keep what it holds instead.
  it('a full cache keeps its working set when candidates past the cap arrive', async () => {
    // Seeded null-session entries reuse purely from memory (no stat, no read),
    // so this exercises storeEntry at the cap without writing 32k transcripts.
    seedSessionParseCache(
      Array.from(
        { length: MAX_CACHE_ENTRIES },
        (_, index): [string, PersistedSessionParseCacheEntry] => [
          `/nonexistent/cached-${index}.jsonl`,
          { mtimeMs: index + 1, sizeBytes: 1, platform: process.platform, session: null }
        ]
      )
    )
    const cachedCandidate = (index: number): SessionFileCandidate => ({
      agent: 'claude',
      file: {
        path: `/nonexistent/cached-${index}.jsonl`,
        mtimeMs: index + 1,
        modifiedAt: new Date(index + 1).toISOString(),
        sizeBytes: 1
      },
      codexHome: null
    })

    // The entries an LRU-head eviction destroys first. Deliberately NOT touched
    // before the overflow — reusing them would move them to the LRU tail and
    // out of the eviction path, which is exactly what would make this test pass
    // against the old policy too.
    const victims = [0, 1, 2, 3, 4]

    // Now push genuinely new transcripts at a cache that is already at its cap.
    tempRoot = await mkdtemp(join(tmpdir(), 'orca-parse-cache-overcap-'))
    await mkdir(tempRoot, { recursive: true })
    const overflowPaths = Array.from({ length: victims.length }, (_, index) =>
      join(tempRoot as string, `overflow-${index}.jsonl`)
    )
    await Promise.all(
      overflowPaths.map((path, index) => writeFile(path, transcriptBody(9000 + index)))
    )
    const overflow = createSessionParseStats()
    for (const path of overflowPaths) {
      await parseAgentSessionFileCached(await candidateFor(path), process.platform, overflow)
    }
    expect(overflow.fullParses).toBe(overflowPaths.length)

    // Head eviction would have dropped exactly these while admitting the new
    // files, so every one of them would re-parse here.
    const after = createSessionParseStats()
    for (const index of victims) {
      await parseAgentSessionFileCached(cachedCandidate(index), process.platform, after)
    }
    expect(after.reused).toBe(victims.length)
    expect(after.fullParses).toBe(0)
  }, 60_000)
})
