import { describe, expect, it } from 'vitest'
import type { LinearIssue } from '../../../src/shared/types'
import type { RpcClient } from '../transport/rpc-client'
import { runSmartSearch } from './use-smart-workspace-source'

function issue(organizationUrlKey: string): LinearIssue {
  return {
    id: `issue-${organizationUrlKey}`,
    workspaceId: `workspace-${organizationUrlKey}`,
    identifier: 'ENG-42',
    title: 'Fix auth',
    url: `https://linear.app/${organizationUrlKey}/issue/ENG-42/fix-auth`,
    state: { name: 'Todo', type: 'unstarted', color: '#888888' },
    team: { id: 'team-1', name: 'Engineering', key: 'ENG' },
    labels: [],
    labelIds: [],
    priority: 0,
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

function clientFor(
  searchItems: LinearIssue[],
  lookupResult: { items: LinearIssue[]; errors?: unknown[] },
  calls: Array<{ method: string; params: unknown }>
): RpcClient {
  return {
    sendRequest: async (method: string, params?: unknown) => {
      calls.push({ method, params })
      const result = method === 'linear.searchIssues' ? searchItems : lookupResult
      return { id: '1', ok: true, result, _meta: { runtimeId: 'runtime-1' } }
    }
  } as unknown as RpcClient
}

function runArgs(client: RpcClient) {
  return {
    client,
    mode: 'linear' as const,
    query: 'https://linear.app/acme/issue/eng-42/fix-auth',
    repoId: null,
    githubAvailable: false,
    gitlabAvailable: false,
    linearAvailable: true,
    mrStateFilter: 'opened' as const,
    linearWorkspaceId: 'workspace-other',
    repos: [],
    dismissedPasteRef: { current: '' },
    repoSlugCache: new Map<string, { owner: string; repo: string } | null>()
  }
}

describe('runSmartSearch Linear URL resolution', () => {
  it('normalizes search and pins the all-workspace organization match', async () => {
    const calls: Array<{ method: string; params: unknown }> = []
    const wrongOrg = issue('other')
    const exact = issue('acme')

    const result = await runSmartSearch(
      runArgs(clientFor([wrongOrg], { items: [wrongOrg, exact], errors: [] }, calls))
    )

    expect(result.paste.linear).toBe(exact)
    expect(result.fan.linearIssues).toEqual([wrongOrg])
    expect(result.linearLinkResolution).toEqual({ status: 'resolved', identifier: 'ENG-42' })
    expect(calls).toEqual([
      {
        method: 'linear.searchIssues',
        params: { query: 'ENG-42', limit: 50, workspaceId: 'workspace-other' }
      },
      {
        method: 'linear.getIssuesByIdentifier',
        params: { identifier: 'ENG-42', workspaceId: 'all' }
      }
    ])
  })

  it('shows an authoritative miss but keeps a colliding search result ordinary', async () => {
    const wrongOrg = issue('other')
    const result = await runSmartSearch(
      runArgs(clientFor([wrongOrg], { items: [wrongOrg], errors: [] }, []))
    )

    expect(result.paste.linear).toBeNull()
    expect(result.fan.linearIssues).toEqual([wrongOrg])
    expect(result.linearLinkResolution).toEqual({ status: 'not-found' })
  })

  it('keeps transient lookup failures silent and non-authoritative', async () => {
    const result = await runSmartSearch(
      runArgs(
        clientFor(
          [],
          {
            items: [],
            errors: [{ workspaceId: 'workspace-acme', type: 'network', message: 'timeout' }]
          },
          []
        )
      )
    )

    expect(result.fan.error).toBe('')
    expect(result.linearLinkResolution).toEqual({ status: 'idle' })
  })

  it('does not resolve Linear links when Linear is unavailable', async () => {
    const calls: Array<{ method: string; params: unknown }> = []
    const args = runArgs(clientFor([], { items: [], errors: [] }, calls))

    const result = await runSmartSearch({ ...args, linearAvailable: false })

    expect(calls).toEqual([])
    expect(result.linearLinkResolution).toEqual({ status: 'idle' })
  })
})
