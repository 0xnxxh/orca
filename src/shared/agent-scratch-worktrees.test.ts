import { describe, expect, it } from 'vitest'
import { isAgentScratchWorktreePath } from './agent-scratch-worktrees'

describe('isAgentScratchWorktreePath', () => {
  it('matches Claude Code sub-agent worktrees', () => {
    expect(
      isAgentScratchWorktreePath('/Users/dev/app/.claude/worktrees/agent-a04ccaaa55ddadb91')
    ).toBe(true)
  })

  it('matches gsd parallel-agent workspaces', () => {
    expect(isAgentScratchWorktreePath('/Users/dev/app/.gsd-workspaces/phase-1-subagent-2')).toBe(
      true
    )
  })

  it('matches Windows path separators and casing', () => {
    expect(
      isAgentScratchWorktreePath('C:\\Users\\dev\\app\\.Claude\\Worktrees\\agent-a04ccaaa')
    ).toBe(true)
  })

  it('matches WSL UNC paths', () => {
    expect(
      isAgentScratchWorktreePath(
        '//wsl.localhost/Ubuntu/home/dev/app/.claude/worktrees/agent-a04ccaaa'
      )
    ).toBe(true)
  })

  it('requires the segments to be consecutive', () => {
    expect(isAgentScratchWorktreePath('/Users/dev/app/.claude/other/worktrees/agent-1')).toBe(false)
  })

  it('does not match undotted claude directories', () => {
    expect(isAgentScratchWorktreePath('/Users/dev/app/claude/worktrees/agent-1')).toBe(false)
  })

  it('does not match user worktree conventions', () => {
    expect(isAgentScratchWorktreePath('/Users/dev/app/.worktrees/feature-x')).toBe(false)
    expect(isAgentScratchWorktreePath('/Users/dev/.superset/worktrees/app/fix-notes')).toBe(false)
    expect(isAgentScratchWorktreePath('/orca/workspaces/app/feature')).toBe(false)
  })
})
