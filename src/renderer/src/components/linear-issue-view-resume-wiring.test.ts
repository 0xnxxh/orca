import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Why: TaskPage is too large to render in a unit test, but the persistence
// contract lives in how its effects are wired, not in the pure module they call.
const SOURCE = readFileSync(join(__dirname, 'TaskPage.tsx'), 'utf8')

const PERSIST_WRITE = 'linearIssueView: serializeLinearIssueViewResumeState('

function persistEffectSource(): string {
  const write = SOURCE.indexOf(PERSIST_WRITE)
  expect(write).toBeGreaterThan(0)
  const start = SOURCE.lastIndexOf('useEffect(() => {', write)
  const end = SOURCE.indexOf('])', write)
  expect(start).toBeGreaterThan(0)
  expect(end).toBeGreaterThan(write)
  return SOURCE.slice(start, end)
}

function hydrationEffectSource(): string {
  const start = SOURCE.indexOf('if (taskResumeAppliedRef.current || !persistedUIReady')
  expect(start).toBeGreaterThan(0)
  const end = SOURCE.indexOf('taskResumeAppliedRef.current = true', start)
  expect(end).toBeGreaterThan(start)
  return SOURCE.slice(start, end)
}

describe('Linear issue view resume wiring', () => {
  it('writes the persisted view from exactly one effect, gated until after hydration', () => {
    expect(SOURCE.match(/linearIssueView:/g)).toHaveLength(1)

    const effect = persistEffectSource()
    expect(effect).toContain('if (!taskResumeApplied)')
    // Why: the first pass after hydration must be skipped or startup rewrites the restored state.
    expect(effect).toContain('linearViewPersistReadyRef.current = true')
  })

  it('keeps the persisted payload independent of the selected workspace', () => {
    // Why: the payload carries every workspace's filter, so a workspace resolving
    // or switching mid-startup cannot make the write depend on effect ordering.
    expect(persistEffectSource()).not.toContain('selectedLinearWorkspaceId')
  })

  it('restores every workspace filter during hydration', () => {
    expect(hydrationEffectSource()).toContain(
      'setLinearIssueFiltersByWorkspaceId(linearIssueView.filtersByWorkspaceId)'
    )
  })

  it('derives the active filter from the selected workspace instead of resetting it', () => {
    expect(SOURCE).toContain('selectLinearWorkspaceIssueFilter(')
    // Why: a mutable previous-workspace ref plus a reset effect is exactly the
    // race this model replaces — a cold start would clear the restored filter.
    expect(SOURCE).not.toContain('previousLinearWorkspaceIdForFiltersRef')
    expect(SOURCE).not.toContain('setLinearAttributeFilter(')
  })
})
