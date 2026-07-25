import { describe, expect, it } from 'vitest'
import {
  planSourceControlCommitMessageGeneration,
  planSourceControlTextGeneration
} from './source-control-generation-plan'

describe('planSourceControlCommitMessageGeneration', () => {
  it('catches empty custom commands without invoking an agent', () => {
    expect(
      planSourceControlCommitMessageGeneration({
        agentId: 'custom',
        model: '',
        customAgentCommand: ''
      })
    ).toEqual({
      ok: false,
      error: 'Custom command is empty. Add one in Settings → Git → AI Commit Messages.'
    })
  })

  it('rejects command templates that render empty input', () => {
    expect(
      planSourceControlCommitMessageGeneration({
        agentId: 'codex',
        model: 'gpt-5.5',
        commandInputTemplate: ''
      })
    ).toEqual({ ok: false, error: 'Command input is empty.' })
  })

  it('plans known agents and includes renderer-only caveats', () => {
    const result = planSourceControlCommitMessageGeneration({
      agentId: 'codex',
      model: 'gpt-5.5',
      thinkingLevel: 'low'
    })

    expect(result.ok && result.commandLabel).toContain('codex exec')
    expect(result.ok && result.delivery).toContain('stdin')
    expect(result.ok && result.caveat).toContain('Windows .cmd')
  })

  it('plans pull-request generation with pull-request variables', () => {
    const result = planSourceControlTextGeneration('pullRequest', {
      agentId: 'codex',
      model: 'gpt-5.5',
      commandInputTemplate: '{basePrompt}\n\nReview {changedFiles}'
    })

    expect(result.ok && result.commandLabel).toContain('codex exec')
  })

  it('expands linkedIssue in commit and pull-request plan previews', () => {
    for (const actionId of ['commitMessage', 'pullRequest'] as const) {
      // Why: `{prompt}` puts the rendered template in argv, so commandLabel shows it.
      const result = planSourceControlTextGeneration(actionId, {
        agentId: 'custom',
        model: '',
        customAgentCommand: 'echo {prompt}',
        commandInputTemplate: 'Fixes #{linkedIssue}'
      })

      expect(result.ok && result.commandLabel).toBe('echo Fixes #123')
    }
  })

  it('prefers caller-supplied variable values over the synthetic sample', () => {
    for (const [linkedIssue, expected] of [
      ['7', 'echo Fixes #7'],
      // Why: an unlinked workspace must preview the empty expansion it will really send,
      // not the synthetic `123`.
      ['', 'echo Fixes #']
    ]) {
      const result = planSourceControlTextGeneration(
        'commitMessage',
        {
          agentId: 'custom',
          model: '',
          customAgentCommand: 'echo {prompt}',
          commandInputTemplate: 'Fixes #{linkedIssue}'
        },
        { linkedIssue }
      )

      expect(result.ok && result.commandLabel).toBe(expected)
    }
  })

  it('leaves linkedIssue literal in branch-name plan previews', () => {
    const result = planSourceControlTextGeneration('branchName', {
      agentId: 'custom',
      model: '',
      customAgentCommand: 'echo {prompt}',
      commandInputTemplate: 'issue {linkedIssue}'
    })

    expect(result.ok && result.commandLabel).toBe('echo issue {linkedIssue}')
  })

  it('shows per-action CLI arguments in dry-run command labels', () => {
    const result = planSourceControlTextGeneration('pullRequest', {
      agentId: 'codex',
      model: 'gpt-5.5',
      agentArgs: '--model gpt-5.4',
      commandInputTemplate: '{basePrompt}'
    })

    expect(result.ok && result.commandLabel).toContain('--model gpt-5.4')
  })
})
