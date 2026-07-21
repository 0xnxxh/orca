import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LinearClientForWorkspace } from './client'

const getClients = vi.fn()
const clearToken = vi.fn()
const isAuthError = vi.fn()

vi.mock('./client', () => ({
  acquire: vi.fn().mockResolvedValue(undefined),
  release: vi.fn(),
  getClients: (...args: unknown[]) => getClients(...args),
  isAuthError: (...args: unknown[]) => isAuthError(...args),
  clearToken: (...args: unknown[]) => clearToken(...args)
}))

function sdkIssue(identifier: string, organizationUrlKey: string) {
  return {
    id: `${organizationUrlKey}-${identifier}`,
    identifier,
    title: identifier,
    description: 'Description',
    url: `https://linear.app/${organizationUrlKey}/issue/${identifier}`,
    estimate: 3,
    priority: 2,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    state: Promise.resolve({ name: 'Todo', type: 'unstarted', color: '#888888' }),
    team: Promise.resolve({ id: 'team-1', name: 'Team', key: 'TM' }),
    assignee: Promise.resolve(undefined),
    labels: async () => ({ nodes: [] })
  }
}

function makeEntry(
  workspaceId: string,
  issue: (id: string) => Promise<unknown>
): LinearClientForWorkspace {
  return {
    workspace: {
      id: workspaceId,
      organizationId: workspaceId,
      organizationName: workspaceId,
      displayName: 'Ada',
      email: 'ada@example.com'
    },
    client: { issue }
  } as unknown as LinearClientForWorkspace
}

describe('Linear issue identifier fan-out', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isAuthError.mockReturnValue(false)
  })

  it('gets every workspace hit for an issue identifier', async () => {
    getClients.mockReturnValue([
      makeEntry('workspace-acme', vi.fn().mockResolvedValue(sdkIssue('ENG-42', 'acme'))),
      makeEntry('workspace-other', vi.fn().mockResolvedValue(sdkIssue('ENG-42', 'other')))
    ])
    const { getIssuesByIdentifier } = await import('./issues')

    await expect(getIssuesByIdentifier('ENG-42')).resolves.toMatchObject({
      items: [
        { identifier: 'ENG-42', workspaceId: 'workspace-acme' },
        { identifier: 'ENG-42', workspaceId: 'workspace-other' }
      ],
      errors: []
    })
    expect(getClients).toHaveBeenCalledWith('all')
  })

  it('treats identifier lookup misses as authoritative empty results', async () => {
    getClients.mockReturnValue([
      makeEntry(
        'workspace-1',
        vi
          .fn()
          .mockRejectedValue(new Error('Entity not found: Issue - Could not find referenced issue'))
      )
    ])
    const { getIssuesByIdentifier } = await import('./issues')

    await expect(getIssuesByIdentifier('ENG-404')).resolves.toEqual({ items: [], errors: [] })
  })

  it('returns transient failures in the workspace error envelope', async () => {
    getClients.mockReturnValue([
      makeEntry('workspace-1', vi.fn().mockRejectedValue(new Error('network timeout'))),
      makeEntry(
        'workspace-2',
        vi.fn().mockRejectedValue(new Error('Issue not found for identifier ENG-404'))
      )
    ])
    const { getIssuesByIdentifier } = await import('./issues')

    await expect(getIssuesByIdentifier('ENG-404')).resolves.toMatchObject({
      items: [],
      errors: [{ workspaceId: 'workspace-1', type: 'network', message: 'network timeout' }]
    })
  })

  it('contains all-workspace authentication failures without collapsing healthy lookups', async () => {
    const authError = new Error('Unauthorized')
    isAuthError.mockImplementation((error) => error === authError)
    getClients.mockReturnValue([
      makeEntry('workspace-auth', vi.fn().mockRejectedValue(authError)),
      makeEntry('workspace-acme', vi.fn().mockResolvedValue(sdkIssue('ENG-42', 'acme')))
    ])
    const { getIssuesByIdentifier } = await import('./issues')

    await expect(getIssuesByIdentifier('ENG-42')).resolves.toMatchObject({
      items: [{ identifier: 'ENG-42', workspaceId: 'workspace-acme' }],
      errors: [{ workspaceId: 'workspace-auth', type: 'auth' }]
    })
    expect(clearToken).toHaveBeenCalledWith('workspace-auth')
  })

  it('returns an empty envelope with no connected workspaces', async () => {
    getClients.mockReturnValue([])
    const { getIssuesByIdentifier } = await import('./issues')

    await expect(getIssuesByIdentifier('ENG-404')).resolves.toEqual({ items: [], errors: [] })
  })
})
