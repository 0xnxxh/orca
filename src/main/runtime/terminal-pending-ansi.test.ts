import { describe, expect, it } from 'vitest'
import { createForceGc, resolveForcedGc } from '../../shared/forced-gc-for-retention-tests'
import { retainTerminalPendingAnsi } from './terminal-pending-ansi'

describe('retainTerminalPendingAnsi', () => {
  it('bounds an incomplete control while preserving its introducer and suffix', () => {
    expect(retainTerminalPendingAnsi(`\x1b]${'x'.repeat(5000)}`)).toBe(`\x1b]${'x'.repeat(4094)}`)
  })

  const forcedGc = resolveForcedGc()
  const itWithGc = forcedGc ? it : it.skip
  itWithGc('does not pin PTY chunks behind pending ANSI state', () => {
    const forceGc = createForceGc(forcedGc!)
    forceGc()
    const before = process.memoryUsage().heapUsed
    const held = Array.from({ length: 512 }, (_unused, index) => {
      const chunk = `${'x'.repeat(16 * 1024)}\x1b]0;partial-${index}`
      return retainTerminalPendingAnsi(chunk.slice(chunk.lastIndexOf('\x1b')))
    })
    forceGc()
    const retainedMiB = (process.memoryUsage().heapUsed - before) / (1024 * 1024)

    expect(held[0]).toBe('\x1b]0;partial-0')
    expect(retainedMiB).toBeLessThan(2)
  })
})
