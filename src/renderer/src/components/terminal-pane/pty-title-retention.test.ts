import { describe, expect, it } from 'vitest'
import { createForceGc, resolveForcedGc } from '../../../../shared/forced-gc-for-retention-tests'
import { createPtyOutputProcessor } from './pty-transport'

// This guards 16 KiB frame detachment, not production's O(panes) overwrite model.
const MIB = 1024 * 1024
const CHUNK_CHARS = 16 * 1024
const PANES = 2048
const PINNED_FRAME_MIB = (CHUNK_CHARS * PANES * 2) / MIB

const forcedGc = resolveForcedGc()
const describeWithGc = forcedGc ? describe : describe.skip
const forceGc = forcedGc ? createForceGc(forcedGc) : (): void => undefined

function makeAgentFrame(index: number): string {
  return `${'█'.repeat(CHUNK_CHARS)}\x1b]0;✳ Working… (esc to interrupt) pane-${index}\x07`
}

describeWithGc('renderer PTY title retention', () => {
  it('does not pin each pane PTY frame behind the title handed to the store', async () => {
    forceGc()
    const before = process.memoryUsage().heapUsed
    const storedTitles: string[] = []

    for (let pane = 0; pane < PANES; pane += 1) {
      const processor = createPtyOutputProcessor({
        onTitleChange: (normalized) => {
          storedTitles.push(normalized)
        }
      })
      processor.processData(makeAgentFrame(pane), { onData: () => undefined })
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    forceGc()
    const retainedMiB = (process.memoryUsage().heapUsed - before) / MIB
    const titleChars = storedTitles.reduce((total, title) => total + title.length, 0)

    console.log(
      `${storedTitles.length} stored pane titles (${titleChars} chars) -> heap delta ${retainedMiB.toFixed(2)} MiB; ` +
        `source frames total ${PINNED_FRAME_MIB} MiB if every title pinned its parent`
    )

    expect(storedTitles).toHaveLength(PANES)
    expect(storedTitles[0]).toBe('✳ Working… (esc to interrupt) pane-0')
    expect(retainedMiB).toBeLessThan(PINNED_FRAME_MIB / 8)
  })
})
