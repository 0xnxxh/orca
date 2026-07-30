import { describe, expect, it } from 'vitest'
import { createForceGc, resolveForcedGc } from './forced-gc-for-retention-tests'
import { extractOscTitleScanTail } from './osc-title-scan-tail'

describe('extractOscTitleScanTail', () => {
  it('keeps incomplete OSC title candidates only', () => {
    expect(extractOscTitleScanTail('\x1b]0;Codex work')).toBe('\x1b]0;Codex work')
    expect(extractOscTitleScanTail('\x1b]2;Codex working\x1b')).toBe('\x1b]2;Codex working\x1b')
    expect(extractOscTitleScanTail('\x1b]')).toBe('\x1b]')
    expect(extractOscTitleScanTail('\x1b]1')).toBe('\x1b]1')
  })

  it('does not carry non-title OSC payloads into the title scanner', () => {
    expect(extractOscTitleScanTail('\x1b]133;D;13')).toBe('')
    expect(extractOscTitleScanTail('\x1b]7;file://host/tmp')).toBe('')
    expect(extractOscTitleScanTail('\x1b]133;D;0\x07\x1b')).toBe('\x1b')
  })

  // Production persists one title scan tail per PTY.
  const forcedGc = resolveForcedGc()
  const itWithGc = forcedGc ? it : it.skip
  itWithGc('does not pin the source chunk behind a carried tail', () => {
    const chunkChars = 16 * 1024
    const ptys = 512
    const forceGc = createForceGc(forcedGc!)
    const makeChunk = (index: number): string =>
      `${'x'.repeat(chunkChars)}\x1b]0;✳ Working… (esc to interrupt) pty-${index}`

    forceGc()
    const before = process.memoryUsage().heapUsed
    const carried = new Map<string, string>()
    for (let index = 0; index < ptys; index += 1) {
      carried.set(`pty-${index}`, extractOscTitleScanTail(makeChunk(index)))
    }
    forceGc()
    const retainedMiB = (process.memoryUsage().heapUsed - before) / (1024 * 1024)

    expect(carried.size).toBe(ptys)
    expect(carried.get('pty-0')).toBe('\x1b]0;✳ Working… (esc to interrupt) pty-0')
    expect(retainedMiB).toBeLessThan(2)
  })
})
