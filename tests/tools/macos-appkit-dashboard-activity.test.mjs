import { describe, expect, it } from 'vitest'
import {
  APPKIT_REPRO_TERMINAL_COUNT,
  buildDashboardActivityScript
} from './macos-appkit-dashboard-activity.mjs'

describe('macOS AppKit dashboard activity fixture', () => {
  it('matches the incident terminal and dashboard churn without changing window geometry', () => {
    const script = buildDashboardActivityScript()

    expect(APPKIT_REPRO_TERMINAL_COUNT).toBe(14)
    expect(() => new Function(`return ${script}`)).not.toThrow()
    expect(script).toContain('createTab')
    expect(script).toContain('window.api.pty.write')
    expect(script).toContain('window.api.dashboard.publishSnapshot')
    expect(script).toContain('setActiveTab')
    expect(script).not.toMatch(/\b(?:resizeTo|resizeBy|moveTo|moveBy)\b/)
    expect(script).not.toMatch(/\.(?:minimize|maximize|restore|setBounds|setSize|setPosition)\b/)
  })

  it('hydrates and activates the fixture workspace before creating terminals', () => {
    const script = buildDashboardActivityScript()

    const fetchRepos = script.indexOf('fetchRepos()')
    const fetchWorktrees = script.indexOf('fetchWorktrees(repo.id)')
    const setActiveRepo = script.indexOf('setActiveRepo(repo.id)')
    const setActiveWorktree = script.indexOf('setActiveWorktree(worktree.id)')
    const createTab = script.indexOf('createTab(worktreeId')

    expect(fetchRepos).toBeGreaterThan(-1)
    expect(fetchWorktrees).toBeGreaterThan(fetchRepos)
    expect(setActiveRepo).toBeGreaterThan(fetchWorktrees)
    expect(setActiveWorktree).toBeGreaterThan(setActiveRepo)
    expect(createTab).toBeGreaterThan(setActiveWorktree)
  })
})
