import { describe, expect, it } from 'vitest'
import type { RuntimeMobileSessionTabsResult } from '../../../shared/runtime-types'
import { projectLocalStructuredSessionTabs } from './local-structured-session-tabs-sync'

describe('local structured session tab projection', () => {
  it('keeps only structured tabs without replaying renderer-owned groups', () => {
    const snapshot = {
      worktree: 'workspace-1',
      publicationEpoch: 'epoch-1',
      snapshotVersion: 1,
      activeGroupId: 'group-1',
      activeTabId: 'agent-session:claude-1',
      activeTabType: 'agent-session',
      tabGroups: [
        {
          id: 'group-1',
          activeTabId: 'agent-session:claude-1',
          tabOrder: ['terminal-1', 'agent-session:claude-1']
        }
      ],
      tabs: [
        {
          type: 'terminal',
          id: 'terminal-1',
          parentTabId: 'terminal-1',
          leafId: 'leaf-1',
          title: 'Terminal',
          status: 'ready',
          terminal: 'term-1',
          ptyId: 'pty-1',
          isActive: false
        },
        {
          type: 'agent-session',
          id: 'agent-session:claude-1',
          title: 'Claude Chat',
          sessionId: 'claude-1',
          agent: 'claude',
          isActive: true
        }
      ]
    } satisfies RuntimeMobileSessionTabsResult

    expect(projectLocalStructuredSessionTabs(snapshot)).toMatchObject({
      tabGroups: undefined,
      tabs: [expect.objectContaining({ type: 'agent-session', agent: 'claude' })]
    })
  })
})
