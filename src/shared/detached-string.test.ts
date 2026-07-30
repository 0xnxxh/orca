import { describe, expect, it } from 'vitest'
import { detachString } from './detached-string'
import { createForceGc, resolveForcedGc } from './forced-gc-for-retention-tests'

describe('detachString', () => {
  it('returns the value unchanged', () => {
    for (const value of ['', 'a', '✳ Working… (esc to interrupt)', '{"questions":[]}', ' \n\t ']) {
      expect(detachString(value)).toBe(value)
    }
  })

  it('preserves surrogate pairs and astral characters', () => {
    const value = '🚀 done \u{1f4a9}'
    expect(detachString(value)).toBe(value)
    expect(detachString(value).length).toBe(value.length)
  })

  it('preserves a lone surrogate', () => {
    const value = '\ud83d'
    expect(detachString(value)).toBe(value)
  })

  // A ≥13-char raw control arm proves both SlicedString retention and default-run GC.
  const forcedGc = resolveForcedGc()
  const itWithGc = forcedGc ? it : it.skip
  itWithGc('detaches a slice from its parent buffer', () => {
    const chunkChars = 16 * 1024
    const slices = 4096
    const forceGc = createForceGc(forcedGc!)
    const measure = (detach: boolean): number => {
      const held: string[] = []
      forceGc()
      const before = process.memoryUsage().heapUsed
      for (let index = 0; index < slices; index += 1) {
        const sliced = `${'x'.repeat(chunkChars)}|retained-title-${index}`.slice(chunkChars + 1)
        held.push(detach ? detachString(sliced) : sliced)
      }
      forceGc()
      const retainedMiB = (process.memoryUsage().heapUsed - before) / (1024 * 1024)
      expect(held).toHaveLength(slices)
      expect(held[0].length).toBeGreaterThanOrEqual(13)
      return retainedMiB
    }

    const attachedMiB = measure(false)
    const detachedMiB = measure(true)
    expect(attachedMiB).toBeGreaterThan(16)
    expect(detachedMiB).toBeLessThan(attachedMiB / 8)
  })
})
