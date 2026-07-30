import { describe, expect, it } from 'vitest'
import { createForceGc, resolveForcedGc } from './forced-gc-for-retention-tests'
import { extractAllOscTitles } from './osc-title-extraction'

// This guards 16 KiB chunk detachment, not a production OOM reproduction.
const MIB = 1024 * 1024
const CHUNK_CHARS = 16 * 1024
const RETAINED_TITLES = 4096
const PINNED_CHUNK_MIB = (CHUNK_CHARS * RETAINED_TITLES) / MIB

const forcedGc = resolveForcedGc()
const describeWithGc = forcedGc ? describe : describe.skip
const forceGc = forcedGc ? createForceGc(forcedGc) : (): void => undefined

function makePtyChunk(index: number): string {
  return `${'x'.repeat(CHUNK_CHARS)}\x1b]0;✳ Working… (esc to interrupt) ${index}\x07`
}

describeWithGc('OSC title retention', () => {
  it('does not pin the source PTY chunk behind a retained title', () => {
    forceGc()
    const before = process.memoryUsage().heapUsed
    const retained: string[] = []
    for (let index = 0; index < RETAINED_TITLES; index += 1) {
      const titles = extractAllOscTitles(makePtyChunk(index))
      retained.push(titles.at(-1) as string)
    }
    forceGc()
    const retainedMiB = (process.memoryUsage().heapUsed - before) / MIB
    const titleChars = retained.reduce((total, title) => total + title.length, 0)

    console.log(
      `retained ${retained.length} titles (${titleChars} chars total) -> heap delta ${retainedMiB.toFixed(2)} MiB; ` +
        `source chunks total ${PINNED_CHUNK_MIB} MiB if every title pinned its parent`
    )

    expect(retained).toHaveLength(RETAINED_TITLES)
    expect(retained[0]).toBe('✳ Working… (esc to interrupt) 0')
    expect(retainedMiB).toBeLessThan(PINNED_CHUNK_MIB / 8)
  })
})
