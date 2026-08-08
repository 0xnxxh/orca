import { afterEach, describe, expect, it } from 'vitest'
import {
  captureParkedTerminalPaneCandidates,
  retireParkedTerminalTab
} from './terminal-parked-watcher-registry'
import {
  resolveParkedTerminalPaneCandidates,
  selectParkedTerminalPaneCandidateKey
} from './terminal-parked-watcher-reconciliation'

const TAB_ID = 'tab-1'
const WORKTREE_ID = 'repo::/worktree'
const FIRST_LEAF_ID = '11111111-1111-4111-8111-111111111111'
const SECOND_LEAF_ID = '22222222-2222-4222-8222-222222222222'
const FIRST_PTY_ID = 'remote:env-1@@terminal-1'
const OLD_SECOND_PTY_ID = 'remote:env-1@@terminal-2'
const NEW_SECOND_PTY_ID = 'remote:env-1@@terminal-3'

afterEach(() => {
  retireParkedTerminalTab(TAB_ID)
})

describe('paired parked-watcher reconciliation', () => {
  it('projects host-owned cold identity only for the persisted pane generation', () => {
    const paneKey = `${TAB_ID}:${FIRST_LEAF_ID}`
    const state = {
      runtimePaneTitlesByTabId: {},
      hostTerminalSideEffectIdentityByPaneKey: {
        [paneKey]: {
          incarnationId: '33333333-3333-4333-8333-333333333333',
          paneGeneration: 4
        }
      },
      terminalLayoutsByTabId: {
        [TAB_ID]: {
          root: { type: 'leaf' as const, leafId: FIRST_LEAF_ID },
          activeLeafId: FIRST_LEAF_ID,
          expandedLeafId: null,
          ptyIdsByLeafId: { [FIRST_LEAF_ID]: FIRST_PTY_ID }
        }
      }
    }

    expect(
      resolveParkedTerminalPaneCandidates({ id: TAB_ID, ptyId: FIRST_PTY_ID, generation: 4 }, state)
    ).toEqual([
      expect.objectContaining({
        sideEffectIdentity: {
          incarnationId: '33333333-3333-4333-8333-333333333333',
          paneGeneration: 4
        }
      })
    ])
    expect(
      resolveParkedTerminalPaneCandidates({ id: TAB_ID, ptyId: FIRST_PTY_ID, generation: 5 }, state)
    ).toEqual([expect.not.objectContaining({ sideEffectIdentity: expect.anything() })])
  })

  it('prefers an authoritative inactive split-leaf remint over the unmount capture', () => {
    captureParkedTerminalPaneCandidates(TAB_ID, WORKTREE_ID, [
      { ptyId: FIRST_PTY_ID, paneId: 1, leafId: FIRST_LEAF_ID, drivesTabTitle: true },
      {
        ptyId: OLD_SECOND_PTY_ID,
        paneId: 2,
        leafId: SECOND_LEAF_ID,
        drivesTabTitle: false
      }
    ])

    const panes = resolveParkedTerminalPaneCandidates(
      { id: TAB_ID, ptyId: FIRST_PTY_ID },
      {
        runtimePaneTitlesByTabId: {},
        terminalLayoutsByTabId: {
          [TAB_ID]: {
            root: {
              type: 'split',
              direction: 'vertical',
              first: { type: 'leaf', leafId: FIRST_LEAF_ID },
              second: { type: 'leaf', leafId: SECOND_LEAF_ID }
            },
            activeLeafId: FIRST_LEAF_ID,
            expandedLeafId: null,
            ptyIdsByLeafId: {
              [FIRST_LEAF_ID]: FIRST_PTY_ID,
              [SECOND_LEAF_ID]: NEW_SECOND_PTY_ID
            }
          }
        }
      }
    )

    expect(panes).toEqual([
      { ptyId: FIRST_PTY_ID, paneId: 1, leafId: FIRST_LEAF_ID, drivesTabTitle: true },
      {
        ptyId: NEW_SECOND_PTY_ID,
        paneId: 2,
        leafId: SECOND_LEAF_ID,
        drivesTabTitle: false
      }
    ])
  })

  it('keys PTY, leaf, and title-driving mutations that require a fresh handoff', () => {
    const state = {
      runtimePaneTitlesByTabId: {},
      terminalLayoutsByTabId: {
        [TAB_ID]: {
          root: {
            type: 'split' as const,
            direction: 'vertical' as const,
            first: { type: 'leaf' as const, leafId: FIRST_LEAF_ID },
            second: { type: 'leaf' as const, leafId: SECOND_LEAF_ID }
          },
          activeLeafId: FIRST_LEAF_ID,
          expandedLeafId: null,
          ptyIdsByLeafId: {
            [FIRST_LEAF_ID]: FIRST_PTY_ID,
            [SECOND_LEAF_ID]: OLD_SECOND_PTY_ID
          }
        }
      }
    }
    const tabs = [{ id: TAB_ID, ptyId: FIRST_PTY_ID }]
    const initial = selectParkedTerminalPaneCandidateKey(state, tabs)

    state.terminalLayoutsByTabId[TAB_ID].activeLeafId = SECOND_LEAF_ID
    const activeChanged = selectParkedTerminalPaneCandidateKey(state, tabs)
    state.terminalLayoutsByTabId[TAB_ID].ptyIdsByLeafId[SECOND_LEAF_ID] = NEW_SECOND_PTY_ID

    expect(activeChanged).not.toBe(initial)
    expect(selectParkedTerminalPaneCandidateKey(state, tabs)).not.toBe(activeChanged)
  })
})
