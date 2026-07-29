import { describe, expect, it } from 'vitest'
import type { TerminalSnapshot } from './types'
import { serializeTerminalCheckpointWithinLimit } from './terminal-checkpoint-serializer'

function snapshotWithCountedLinks(
  linkCount: number,
  uri: string
): {
  snapshot: TerminalSnapshot
  uriReads: () => number
} {
  let reads = 0
  const oscLinks = Array.from({ length: linkCount }, (_, row) => ({
    row,
    startCol: 0,
    endCol: 1,
    get uri(): string {
      reads += 1
      return uri
    }
  }))
  return {
    snapshot: {
      snapshotAnsi: 'visible',
      scrollbackAnsi: '',
      oscLinks,
      rehydrateSequences: '',
      cwd: '/workspace',
      modes: {
        bracketedPaste: false,
        mouseTracking: false,
        applicationCursor: false,
        alternateScreen: false
      },
      cols: 80,
      rows: 24,
      scrollbackLines: 0
    },
    uriReads: () => reads
  }
}

describe('terminal checkpoint serializer', () => {
  it('traverses a large checkpoint payload once', async () => {
    const linkCount = 4_096
    const { snapshot, uriReads } = snapshotWithCountedLinks(
      linkCount,
      `https://example.com/${'x'.repeat(4_096)}`
    )

    const json = await serializeTerminalCheckpointWithinLimit(
      snapshot,
      { cwd: snapshot.cwd, generation: 1, checkpointedAt: '2026-07-29T00:00:00.000Z' },
      20 * 1024 * 1024
    )

    expect(Buffer.byteLength(json, 'utf8')).toBeLessThanOrEqual(20 * 1024 * 1024)
    expect(uriReads()).toBe(linkCount)
  })
})
