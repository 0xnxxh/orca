import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../../app/h/[hostId]/tasks.tsx', import.meta.url), 'utf8')

// loadTasks is the only path that calls loadRepos, so the ordering inside it is
// what decides whether Project rows have repos to match against.
function loadTasksBody(): string {
  const start = source.indexOf('const loadTasks = useCallback(')
  expect(start, 'loadTasks must exist in the tasks route').toBeGreaterThan(-1)
  const end = source.indexOf('const connectLinearAccount = useCallback(', start)
  expect(end, 'loadTasks must be followed by connectLinearAccount').toBeGreaterThan(start)
  return source.slice(start, end)
}

function offsets(): {
  repoLoad: number
  projectReturn: number
  workItemFetch: number
} {
  const body = loadTasksBody()
  return {
    repoLoad: body.indexOf('await loadRepos()'),
    projectReturn: body.indexOf("provider === 'github' && githubMode === 'project'"),
    workItemFetch: body.indexOf("provider === 'github' || provider === 'gitlab'")
  }
}

describe('mobile GitHub Project repo list loading', () => {
  it('keeps loadRepos on the loadTasks path', () => {
    expect(offsets().repoLoad, 'loadTasks must still load the repo list').toBeGreaterThan(-1)
  })

  // Regression: project mode returned before loadRepos(), so hostedRepos stayed
  // empty, filterGitHubProjectRowsForRepos matched nothing, and the board read
  // "No project items" until another mode populated repos as a side effect.
  it('loads the repo list before project mode bails out', () => {
    const { repoLoad, projectReturn } = offsets()
    expect(projectReturn, 'project mode must still short-circuit loadTasks').toBeGreaterThan(-1)
    expect(projectReturn, 'project mode must bail out after the repo list load').toBeGreaterThan(
      repoLoad
    )
  })

  it('still bails out before any work-item fetch in project mode', () => {
    const { projectReturn, workItemFetch } = offsets()
    expect(workItemFetch, 'the hosted work-item fetch must still exist').toBeGreaterThan(-1)
    expect(workItemFetch, 'project mode must not reach the issue/PR fetch').toBeGreaterThan(
      projectReturn
    )
  })
})
