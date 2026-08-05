import { describe, expect, it, vi } from 'vitest'
import { getDefaultUIState } from '../../../../shared/constants'
import { LINEAR_ISSUE_ATTRIBUTE_FILTER_ID_MAX_LENGTH } from '../../../../shared/linear-issue-attribute-filter'
import type { OrcaRuntimeService } from '../../orca-runtime'
import type { RpcRequest } from '../core'
import { RpcDispatcher } from '../dispatcher'
import { CLIENT_UI_METHODS } from './client-ui'

function makeRequest(params: unknown): RpcRequest {
  return { id: 'req-1', authToken: 'tok', method: 'ui.set', params }
}

function makeDispatcher(): { dispatcher: RpcDispatcher; updateUIState: ReturnType<typeof vi.fn> } {
  const updateUIState = vi.fn(() => getDefaultUIState())
  const runtime = {
    getRuntimeId: () => 'test-runtime',
    updateUIState
  } as unknown as OrcaRuntimeService
  return { dispatcher: new RpcDispatcher({ runtime, methods: CLIENT_UI_METHODS }), updateUIState }
}

const VALID_VIEW = {
  viewMode: 'list',
  groupBy: 'none',
  orderBy: 'priority',
  displayProperties: [],
  teamPropertyTouched: false,
  filtersByWorkspaceId: {}
}

describe('ui.set Linear issue view resume state', () => {
  // Why: the schema is strict, so a field the renderer persists but the schema
  // omits drops the whole taskResumeState for paired web/mobile/relay clients.
  it.each([
    [
      'a fully populated view',
      {
        viewMode: 'board',
        groupBy: 'assignee',
        orderBy: 'updated',
        displayProperties: ['state', 'labels'],
        teamPropertyTouched: true,
        filtersByWorkspaceId: {
          'workspace-1': {
            stateIds: ['state-1'],
            priorities: [2],
            assignee: { kind: 'user', id: 'user-1' },
            labelIds: ['label-1']
          },
          'workspace-2': {
            stateIds: [],
            priorities: [],
            assignee: { kind: 'unassigned' },
            labelIds: ['label-2']
          }
        }
      }
    ],
    // Why: an empty display-property array means every column is hidden, not "unset".
    ['every column hidden and no filters', VALID_VIEW]
  ])('accepts %s', async (_label, linearIssueView) => {
    const { dispatcher, updateUIState } = makeDispatcher()

    const response = await dispatcher.dispatch(
      makeRequest({ taskResumeState: { linearIssueView } })
    )

    expect(response).toMatchObject({ ok: true })
    expect(updateUIState).toHaveBeenCalledWith({ taskResumeState: { linearIssueView } })
  })

  it.each([
    ['an unlisted key', { ...VALID_VIEW, linearIssueFilterWorkspaceId: 'workspace-1' }],
    ['an unknown view mode', { ...VALID_VIEW, viewMode: 'grid' }],
    ['an unknown display property', { ...VALID_VIEW, displayProperties: ['state', 'bogus'] }],
    ['a missing required field', { viewMode: 'board', groupBy: 'none' }],
    ['a non-object filter', { ...VALID_VIEW, filtersByWorkspaceId: { 'workspace-1': 'all' } }],
    [
      'an out-of-range priority',
      {
        ...VALID_VIEW,
        filtersByWorkspaceId: {
          'workspace-1': { stateIds: [], priorities: [9], assignee: null, labelIds: [] }
        }
      }
    ],
    [
      'an over-long facet id',
      {
        ...VALID_VIEW,
        filtersByWorkspaceId: {
          'workspace-1': {
            stateIds: ['x'.repeat(LINEAR_ISSUE_ATTRIBUTE_FILTER_ID_MAX_LENGTH + 1)],
            priorities: [],
            assignee: null,
            labelIds: []
          }
        }
      }
    ]
  ])('refuses to persist a view with %s', async (_label, linearIssueView) => {
    const { dispatcher, updateUIState } = makeDispatcher()

    const response = await dispatcher.dispatch(
      makeRequest({ sidebarWidth: 280, taskResumeState: { linearIssueView } })
    )

    // Why: taskResumeState rides the value-tolerant wrapper, so an invalid view is
    // dropped from the batch rather than written — the rest of the payload lands.
    expect(response).toMatchObject({ ok: true })
    expect(updateUIState).toHaveBeenCalledWith({ sidebarWidth: 280 })
  })
})
