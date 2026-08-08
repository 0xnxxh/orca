import { beforeEach, describe, expect, it, vi } from 'vitest'

const recordBreadcrumb = vi.fn()
vi.mock('@/lib/crash-breadcrumb-recorder', () => ({
  recordRendererCrashBreadcrumb: (...args: unknown[]) => recordBreadcrumb(...args)
}))

const { recordParkVerdictFlips } = await import('./terminal-park-verdict-flip-telemetry')

const TAB = 'tab-1'

function observe(args: {
  previousParkedByTabId: Map<string, boolean>
  parked: boolean
  liveTabIds?: ReadonlySet<string>
}): void {
  recordParkVerdictFlips({
    previousParkedByTabId: args.previousParkedByTabId,
    liveTabIds: args.liveTabIds ?? new Set([TAB]),
    nextParkedTabIds: args.parked ? new Set([TAB]) : new Set()
  })
}

beforeEach(() => recordBreadcrumb.mockClear())

describe('recordParkVerdictFlips', () => {
  it('seeds and repeats stable verdicts without recording noise', () => {
    const previousParkedByTabId = new Map<string, boolean>()
    observe({ previousParkedByTabId, parked: false })
    observe({ previousParkedByTabId, parked: false })

    expect(recordBreadcrumb).not.toHaveBeenCalled()
    expect(previousParkedByTabId.get(TAB)).toBe(false)
  })

  it('records each observed final-verdict transition without changing it', () => {
    const previousParkedByTabId = new Map<string, boolean>()
    observe({ previousParkedByTabId, parked: false })
    observe({ previousParkedByTabId, parked: true })
    observe({ previousParkedByTabId, parked: false })

    expect(recordBreadcrumb.mock.calls).toEqual([
      ['terminal_park_verdict_churn', { tabId: TAB, trigger: 'flip', parked: true }],
      ['terminal_park_verdict_churn', { tabId: TAB, trigger: 'flip', parked: false }]
    ])
    expect(previousParkedByTabId.get(TAB)).toBe(false)
  })

  it('drops verdict state for tabs that no longer exist', () => {
    const previousParkedByTabId = new Map([[TAB, true]])
    observe({ previousParkedByTabId, parked: false, liveTabIds: new Set() })

    expect(previousParkedByTabId.size).toBe(0)
    expect(recordBreadcrumb).not.toHaveBeenCalled()
  })
})
