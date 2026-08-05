import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Why: TaskPage is too large to render in a unit test, so the decisions live in
// task-page-linear-issue-request.ts where they are unit-tested directly. What is
// left to pin here is that the effects delegate to them rather than re-deriving.
const TASK_PAGE_SOURCE = readFileSync(join(__dirname, 'TaskPage.tsx'), 'utf8')

function sourceBetween(source: string, startPattern: string, endPattern: string): string {
  const start = source.indexOf(startPattern)
  expect(start).toBeGreaterThanOrEqual(0)
  const end = source.indexOf(endPattern, start + startPattern.length)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

function persistEffectSource(): string {
  const write = TASK_PAGE_SOURCE.indexOf('linearIssueView: serializeLinearIssueViewResumeState(')
  expect(write).toBeGreaterThan(0)
  const start = TASK_PAGE_SOURCE.lastIndexOf('useEffect(() => {', write)
  expect(start).toBeGreaterThan(0)
  return TASK_PAGE_SOURCE.slice(start, TASK_PAGE_SOURCE.indexOf('])', write))
}

describe('TaskPage Linear issue view persistence boundary', () => {
  it('writes the persisted view from exactly one effect, gated by the tested predicate', () => {
    expect(TASK_PAGE_SOURCE.match(/linearIssueView:/g)).toHaveLength(1)

    const effect = persistEffectSource()
    // Why: the gate is `shouldPersistLinearIssueView` in task-page-linear-issue-request.ts,
    // which owns the hydration-first-pass skip; inlining it here would leave it untested.
    expect(effect).toContain('shouldPersistLinearIssueView({')
    expect(
      sourceBetween(effect, 'shouldPersistLinearIssueView({', 'setTaskResumeState(')
    ).toContain('return')
  })

  it('keeps the persisted payload independent of the selected workspace', () => {
    // Why: the payload carries every workspace's filter, so a workspace resolving
    // or switching mid-startup cannot make the write depend on effect ordering.
    expect(persistEffectSource()).not.toContain('selectedLinearWorkspaceId')
  })

  it('restores every workspace filter during hydration', () => {
    const hydration = sourceBetween(
      TASK_PAGE_SOURCE,
      'if (taskResumeAppliedRef.current || !persistedUIReady',
      'taskResumeAppliedRef.current = true'
    )
    expect(hydration).toContain(
      'setLinearIssueFiltersByWorkspaceId(linearIssueView.filtersByWorkspaceId)'
    )
  })

  it('derives the active filter from the selected workspace instead of resetting it', () => {
    expect(TASK_PAGE_SOURCE).toContain('selectLinearWorkspaceIssueFilter(')
    // Why: a mutable previous-workspace ref plus a reset effect is exactly the
    // race this model replaces — a cold start would clear the restored filter.
    expect(TASK_PAGE_SOURCE).not.toContain('previousLinearWorkspaceIdForFiltersRef')
    expect(TASK_PAGE_SOURCE).not.toContain('setLinearAttributeFilter(')
  })
})
