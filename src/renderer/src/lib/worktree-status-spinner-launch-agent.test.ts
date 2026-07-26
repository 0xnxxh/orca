import { describe, expect, it } from 'vitest'
import { buildTitleDerivedAgentRows } from '@/components/sidebar/worktree-title-derived-agent-rows'
import type { TerminalLayoutSnapshot, TerminalTab } from '../../../shared/types'
import { getWorktreeStatus } from './worktree-status'

const LEAF_ID = '11111111-1111-4111-8111-111111111111'

function livePtyMap(...tabIds: string[]): Record<string, string[]> {
  return Object.fromEntries(tabIds.map((id, i) => [id, [`pty-${i}`]]))
}

function singleLeafLayout(): TerminalLayoutSnapshot {
  return {
    root: { type: 'leaf', leafId: LEAF_ID },
    activeLeafId: LEAF_ID,
    titlesByLeafId: {}
  } as unknown as TerminalLayoutSnapshot
}

function rowCount(tab: Partial<TerminalTab>, paneTitles?: Record<number, string>): number {
  return buildTitleDerivedAgentRows({
    tabs: [{ id: 'tab-1', title: 'bash', ...tab } as TerminalTab],
    runtimePaneTitlesByTabId: paneTitles ? { 'tab-1': paneTitles } : {},
    ptyIdsByTabId: livePtyMap('tab-1'),
    terminalLayoutsByTabId: { 'tab-1': singleLeafLayout() },
    seenPaneKeys: new Set(),
    now: 0
  }).length
}

// Why: #9040 — Claude's thinking title is a braille spinner plus task text with no
// provider token, so the dot's attribution gate rejected it and the worktree resolved
// to 'active', which renders the same emerald dot as 'done'. The sidebar row builder
// already falls back to the tab's launch identity for spinner titles (#9647); the dot
// must agree.
describe('#9040 worktree dot attributes spinner titles to the launched agent', () => {
  it('spins for a Claude spinner title when the tab was launched as claude', () => {
    const status = getWorktreeStatus(
      [{ id: 'tab-1', title: '⠋ implementing the feature', launchAgent: 'claude' }],
      [],
      livePtyMap('tab-1')
    )

    expect(status).toBe('working')
  })

  it('spins for a spinner-only pane title when the tab was launched as claude', () => {
    const status = getWorktreeStatus(
      [{ id: 'tab-1', title: 'bash', launchAgent: 'claude' }],
      [],
      livePtyMap('tab-1'),
      { 'tab-1': { 0: '⠙ refactoring the parser' } }
    )

    expect(status).toBe('working')
  })

  // Why: pins the #9647 gate — spinner attribution needs a launch identity, so a
  // frozen spinner frame left by an exited agent still cannot spin the dot forever.
  it('stays active for a spinner title with no launch identity', () => {
    const status = getWorktreeStatus(
      [{ id: 'tab-1', title: '⠐ Review branch for regressions' }],
      [],
      livePtyMap('tab-1')
    )

    expect(status).toBe('active')
  })

  it('does not manufacture activity from a non-spinner title with a launch identity', () => {
    const status = getWorktreeStatus(
      [{ id: 'tab-1', title: 'bash', launchAgent: 'claude' }],
      [],
      livePtyMap('tab-1')
    )

    expect(status).toBe('active')
  })
})

// Why: the gate's stated purpose is that the dot never spins with no matching sidebar
// row. Claude's spinner title must reach the same dot/row agreement a named provider
// already gets — no better, and no worse.
describe('#9040 spinner attribution matches named-provider dot/row agreement', () => {
  it('produces a sidebar row alongside the dot, like a named provider does', () => {
    const spinnerTab = {
      id: 'tab-1',
      title: '⠋ implementing the feature',
      launchAgent: 'claude'
    } satisfies Partial<TerminalTab>
    const namedTab = { id: 'tab-1', title: 'claude [working]' }

    expect(getWorktreeStatus([spinnerTab], [], livePtyMap('tab-1'))).toBe('working')
    expect(rowCount(spinnerTab)).toBe(1)
    // Control: the pre-existing named-provider path resolves to the same pair.
    expect(getWorktreeStatus([namedTab], [], livePtyMap('tab-1'))).toBe('working')
    expect(rowCount(namedTab)).toBe(1)
  })

  it('agrees for a spinner pane title too', () => {
    const tab = { id: 'tab-1', title: 'bash', launchAgent: 'claude' } satisfies Partial<TerminalTab>
    const paneTitles = { 'tab-1': { 0: '⠙ refactoring the parser' } }
    const layouts = { 'tab-1': singleLeafLayout() }

    expect(
      getWorktreeStatus([tab], [], livePtyMap('tab-1'), paneTitles, {
        terminalLayoutsByTabId: layouts
      })
    ).toBe('working')
    expect(rowCount(tab, paneTitles['tab-1'])).toBe(1)
  })
})
