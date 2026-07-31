import { beforeEach, describe, expect, it } from 'vitest'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import {
  resetAgentPaneAuthorityAliasesForTests,
  resolveAgentPaneAuthorityKey
} from './agent-pane-authority'
import { createTestStore } from './store-test-helpers'

const LEAF_1 = '11111111-1111-4111-8111-111111111111'
const LEAF_2 = '22222222-2222-4222-8222-222222222222'

describe('setTabLayout PTY ownership', () => {
  beforeEach(() => {
    resetAgentPaneAuthorityAliasesForTests()
  })

  it('normalizes duplicate PTY surfaces at the renderer state boundary', () => {
    const store = createTestStore()

    store.getState().setTabLayout('tab-1', {
      root: {
        type: 'split',
        direction: 'vertical',
        first: { type: 'leaf', leafId: LEAF_1 },
        second: { type: 'leaf', leafId: LEAF_2 }
      },
      activeLeafId: LEAF_2,
      expandedLeafId: null,
      ptyIdsByLeafId: {
        [LEAF_1]: 'pty-agent',
        [LEAF_2]: 'pty-agent'
      }
    })

    expect(store.getState().terminalLayoutsByTabId['tab-1']).toEqual({
      root: { type: 'leaf', leafId: LEAF_2 },
      activeLeafId: LEAF_2,
      expandedLeafId: null,
      ptyIdsByLeafId: { [LEAF_2]: 'pty-agent' }
    })
  })

  it('preserves valid live layouts and legacy leaf ids by identity', () => {
    const store = createTestStore()
    const layout = {
      root: {
        type: 'split' as const,
        direction: 'horizontal' as const,
        first: { type: 'leaf' as const, leafId: 'pane:1' },
        second: { type: 'leaf' as const, leafId: 'pane:2' }
      },
      activeLeafId: 'pane:2',
      expandedLeafId: 'pane:1',
      ptyIdsByLeafId: {
        'pane:1': 'pty-local',
        'pane:2': 'remote:env-1@@term_remote'
      }
    }

    store.getState().setTabLayout('tab-1', layout)

    expect(store.getState().terminalLayoutsByTabId['tab-1']).toBe(layout)
  })

  it('moves live and future pane authority onto the retained PTY leaf', () => {
    const store = createTestStore()
    const removedPaneKey = makePaneKey('tab-1', LEAF_1)
    const retainedPaneKey = makePaneKey('tab-1', LEAF_2)
    store.getState().setAgentStatus(removedPaneKey, {
      state: 'working',
      prompt: 'before repair',
      agentType: 'codex'
    })

    store.getState().setTabLayout('tab-1', {
      root: {
        type: 'split',
        direction: 'vertical',
        first: { type: 'leaf', leafId: LEAF_1 },
        second: { type: 'leaf', leafId: LEAF_2 }
      },
      activeLeafId: LEAF_2,
      expandedLeafId: null,
      ptyIdsByLeafId: {
        [LEAF_1]: 'pty-agent',
        [LEAF_2]: 'pty-agent'
      }
    })

    expect(store.getState().agentStatusByPaneKey[removedPaneKey]).toBeUndefined()
    expect(store.getState().agentStatusByPaneKey[retainedPaneKey]?.prompt).toBe('before repair')
    expect(resolveAgentPaneAuthorityKey(removedPaneKey)).toBe(retainedPaneKey)

    store.getState().setAgentStatus(removedPaneKey, {
      state: 'working',
      prompt: 'after repair',
      agentType: 'codex'
    })
    expect(store.getState().agentStatusByPaneKey[retainedPaneKey]?.prompt).toBe('after repair')
  })

  it('scopes ownership to a tab so detach handoffs can share a PTY across tabs', () => {
    const store = createTestStore()
    const sourceLayout = {
      root: { type: 'leaf' as const, leafId: LEAF_1 },
      activeLeafId: LEAF_1,
      expandedLeafId: null,
      ptyIdsByLeafId: { [LEAF_1]: 'pty-detached' }
    }
    const targetLayout = {
      root: { type: 'leaf' as const, leafId: LEAF_2 },
      activeLeafId: LEAF_2,
      expandedLeafId: null,
      ptyIdsByLeafId: { [LEAF_2]: 'pty-detached' }
    }

    store.getState().setTabLayout('source-tab', sourceLayout)
    store.getState().setTabLayout('target-tab', targetLayout)

    expect(store.getState().terminalLayoutsByTabId['source-tab']).toBe(sourceLayout)
    expect(store.getState().terminalLayoutsByTabId['target-tab']).toBe(targetLayout)
  })
})
