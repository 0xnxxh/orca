import { describe, expect, it } from 'vitest'
import { getWorktreeStatus } from './worktree-status'

function livePtyMap(...tabIds: string[]): Record<string, string[]> {
  return Object.fromEntries(tabIds.map((id, i) => [id, [`pty-${i}`]]))
}

// Why: #9040 — Claude's thinking title is a braille spinner plus task text with no
// provider token, so the dot's attribution gate rejected it and the worktree stayed
// grey while Claude was clearly working. The sidebar row builder already falls back
// to the tab's launch identity for spinner-only titles (#9647); the dot must agree.
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
