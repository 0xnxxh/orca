import { describe, expect, it } from 'vitest'
import type { RuntimeMobileSessionTabsResult } from '../../../shared/runtime-types'
import { projectLocalStructuredSessionTabs } from './local-structured-session-tabs-sync'

describe('local structured session tab projection', () => {
  it('drops terminal topology while retaining structured tabs', () => {
    const snapshot = {
      worktree: 'workspace-1',
      publicationEpoch: 'epoch-1',
      snapshotVersion: 1,
      activeGroupId: 'structured-group',
      activeTabId: 'agent-session:codex-1',
      activeTabType: 'agent-session',
      tabGroups: [
        {
          id: 'terminal-group',
          activeTabId: 'terminal-1',
          tabOrder: ['terminal-1']
        },
        {
          id: 'structured-group',
          activeTabId: 'agent-session:codex-1',
          tabOrder: ['agent-session:codex-1']
        }
      ],
      tabGroupLayout: {
        type: 'split',
        direction: 'horizontal',
        first: { type: 'leaf', groupId: 'terminal-group' },
        second: { type: 'leaf', groupId: 'structured-group' }
      },
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
          id: 'agent-session:codex-1',
          title: 'Codex Chat',
          sessionId: 'codex-1',
          agent: 'codex',
          isActive: true
        }
      ]
    } satisfies RuntimeMobileSessionTabsResult

    expect(projectLocalStructuredSessionTabs(snapshot)).toMatchObject({
      tabGroups: undefined,
      tabGroupLayout: undefined,
      tabs: [expect.objectContaining({ type: 'agent-session', agent: 'codex' })]
    })
  })
})
