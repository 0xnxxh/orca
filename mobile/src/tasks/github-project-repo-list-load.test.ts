import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** Wiring assertions only. The repo-list behaviour itself (caching, client
 *  scoping, stale responses, retry) is covered behaviourally in
 *  host-repo-list.test.ts and use-host-repo-list.test.tsx. What cannot be
 *  reached from there is how this 15k-line route consumes the resource, so
 *  these pin the consumption points the original bug lived in. */
const source = readFileSync(new URL('../../app/h/[hostId]/tasks.tsx', import.meta.url), 'utf8')

function loadTasksBody(): string {
  const start = source.indexOf('const loadTasks = useCallback(')
  expect(start, 'loadTasks must exist in the tasks route').toBeGreaterThan(-1)
  const end = source.indexOf('const connectLinearAccount = useCallback(', start)
  expect(end, 'loadTasks must be followed by connectLinearAccount').toBeGreaterThan(start)
  return source.slice(start, end)
}

describe('mobile GitHub Project repo list loading', () => {
  // Regression (#12966): project mode returned before the repo list was ever
  // loaded, so hostedRepos stayed empty and every board row was filtered out.
  it('loads the repo list before project mode bails out', () => {
    const body = loadTasksBody()
    const repoLoad = body.indexOf('const repoListRequest = repoListEnsureLoaded()')
    const repoAwait = body.indexOf('await repoListRequest')
    const projectReturn = body.indexOf("provider === 'github' && githubMode === 'project'")
    expect(repoLoad, 'loadTasks must load the repo list').toBeGreaterThan(-1)
    expect(projectReturn, 'project mode must still short-circuit loadTasks').toBeGreaterThan(-1)
    expect(repoAwait, 'the repo list must be awaited, not just started').toBeGreaterThan(repoLoad)
    expect(projectReturn, 'project mode must bail out after the repo list load').toBeGreaterThan(
      repoAwait
    )
  })

  it('still bails out before any work-item fetch in project mode', () => {
    const body = loadTasksBody()
    const projectReturn = body.indexOf("provider === 'github' && githubMode === 'project'")
    const workItemFetch = body.indexOf("provider === 'github' || provider === 'gitlab'")
    expect(workItemFetch, 'the hosted work-item fetch must still exist').toBeGreaterThan(-1)
    expect(workItemFetch, 'project mode must not reach the issue/PR fetch').toBeGreaterThan(
      projectReturn
    )
  })

  it('keeps the repo list in the resource rather than local state', () => {
    expect(source).toContain('const repos = repoList.state.repos')
    expect(source, 'a second copy of the list would drift from the resource').not.toContain(
      'const [repos, setRepos]'
    )
    expect(source).not.toContain('reposRef')
  })
})

describe('mobile GitHub Project readiness and refresh', () => {
  // `every` is vacuously true on an empty list, so readiness must ask the
  // resource whether that list is real yet rather than infer it.
  it('derives slug readiness from the resource status', () => {
    const start = source.indexOf('const githubProjectRepoSlugReady = useMemo(')
    expect(start, 'slug readiness memo must exist').toBeGreaterThan(-1)
    const body = source.slice(start, source.indexOf('  )', start))
    expect(body).toContain('hasSettledHostRepoList(repoList.state)')
    expect(body).toContain('[githubRepoSlugCache, hostedRepos, repoList.state]')
  })

  it('re-reads the host and retries failed slug lookups on refresh', () => {
    const start = source.indexOf('const refreshTasks = useCallback(')
    expect(start, 'refresh must be a single shared callback').toBeGreaterThan(-1)
    expect(source.slice(start, source.indexOf('}, [', start))).toContain('repoListReload()')

    const project = source.indexOf('const refreshGitHubProject = useCallback(')
    expect(project, 'project refresh must be a single shared callback').toBeGreaterThan(-1)
    const projectBody = source.slice(project, source.indexOf('}, [', project))
    expect(projectBody).toContain('dropFailedGitHubRepoSlugEntries')
    expect(projectBody).toContain('refreshTasks()')
    expect(projectBody).toContain('loadGitHubProjectTable(')
  })

  it('routes every refresh control through those callbacks', () => {
    expect(source).toContain('onRefresh={refreshTasks}')
    expect(source).toContain('onRefresh={refreshGitHubProject}')
    expect(source, 'no refresh control may call loadTasks directly').not.toContain(
      'onRefresh={() => void loadTasks('
    )
  })

  it('marks a failed slug lookup as retryable rather than resolved', () => {
    expect(source).toContain('repository: null, failed: true')
  })

  // Regression: Expo reuses this screen for the next host, so an effect-based
  // reset runs a render too late and the previous host's rows show through.
  it('clears the other client-scoped caches during render, not in an effect', () => {
    const start = source.indexOf('if (boundClient !== client) {')
    expect(start, 'the client-scoped reset must run during render').toBeGreaterThan(-1)
    const body = source.slice(start, source.indexOf('\n  }', start))
    expect(body).toContain('setItems([])')
    expect(body).toContain('setGithubRepoSlugCache({})')
    expect(body).toContain('repoSelectionHydratedRef.current = false')
  })
})
