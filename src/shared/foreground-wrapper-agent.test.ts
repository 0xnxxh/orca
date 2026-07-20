import { describe, expect, it } from 'vitest'
import { resolveOuterWrapperForegroundProcess } from './foreground-wrapper-agent'

describe('resolveOuterWrapperForegroundProcess', () => {
  const omp = { agent: 'omp' as const, processName: 'omp' }
  const pi = { agent: 'pi' as const, processName: 'pi' }

  it('collapses a wrapped pi read onto the shallower omp wrapper', () => {
    // Winner is the deeper pi (depth 2); omp is its wrapper at depth 1.
    expect(
      resolveOuterWrapperForegroundProcess(pi, 2, [
        { command: 'pi', depth: 2 },
        { command: 'omp', depth: 1 }
      ])
    ).toBe('omp')
  })

  it('keeps bare pi when no same-group wrapper is present', () => {
    expect(resolveOuterWrapperForegroundProcess(pi, 1, [{ command: 'pi', depth: 1 }])).toBe('pi')
  })

  it('leaves a cross-group agent (codex) untouched even under a deeper same-name child', () => {
    const codex = { agent: 'codex' as const, processName: 'codex' }
    expect(
      resolveOuterWrapperForegroundProcess(codex, 2, [
        { command: 'node /usr/bin/codex', depth: 2 },
        { command: 'bash -l', depth: 1 }
      ])
    ).toBe('codex')
  })

  it('does not promote a deeper pi over an already-outer omp winner', () => {
    expect(
      resolveOuterWrapperForegroundProcess(omp, 1, [
        { command: 'omp', depth: 1 },
        { command: 'pi', depth: 2 }
      ])
    ).toBe('omp')
  })
})
