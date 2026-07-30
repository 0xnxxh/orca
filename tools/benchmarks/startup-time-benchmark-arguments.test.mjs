import { describe, expect, it } from 'vitest'
import { parseStartupBenchmarkArgs } from './startup-time-benchmark-arguments.mjs'

describe('parseStartupBenchmarkArgs', () => {
  it('defaults to the milestone available in older baseline builds', () => {
    expect(parseStartupBenchmarkArgs(['node', 'startup-time-bench.mjs']).waitForEvent).toBe(
      'did-finish-load'
    )
  })

  it('allows callers to wait explicitly for the shell paint milestone', () => {
    expect(
      parseStartupBenchmarkArgs([
        'node',
        'startup-time-bench.mjs',
        '--wait-for-event',
        'renderer-shell-painted'
      ]).waitForEvent
    ).toBe('renderer-shell-painted')
  })
})
