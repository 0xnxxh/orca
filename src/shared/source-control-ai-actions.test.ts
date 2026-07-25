import { describe, expect, it } from 'vitest'
import {
  formatLinkedIssueTemplateValue,
  normalizeSourceControlAiActionDefaults,
  SOURCE_CONTROL_ACTION_VARIABLE_INFO,
  SOURCE_CONTROL_ACTION_VARIABLES,
  SOURCE_CONTROL_LAUNCH_ACTION_IDS,
  SOURCE_CONTROL_LAUNCH_ACTION_LABELS,
  DEFAULT_SOURCE_CONTROL_ACTION_COMMAND_TEMPLATES,
  readSourceControlActionDefault,
  renderSourceControlActionCommandTemplate,
  resolveSourceControlActionCommandTemplate,
  setSourceControlActionAgentDefault,
  withLinkedIssueDraftContext
} from './source-control-ai-actions'

describe('source-control AI launch action defaults', () => {
  it('normalizes safe launch action defaults', () => {
    expect(
      normalizeSourceControlAiActionDefaults({
        fixChecks: {
          agentId: 'codex',
          commandInputTemplate: '  {basePrompt}  ',
          agentArgs: '  --model gpt-5.5  '
        },
        resolveConflicts: { agentId: null },
        resolveComments: {
          commandInputTemplate: 'Resolve {basePrompt}'
        },
        pullRequest: { agentId: 'claude' }
      })
    ).toEqual({
      fixChecks: {
        agentId: 'codex',
        commandInputTemplate: '  {basePrompt}  ',
        agentArgs: '  --model gpt-5.5  '
      },
      resolveConflicts: { agentId: null },
      resolveComments: {
        commandInputTemplate: 'Resolve {basePrompt}'
      },
      pullRequest: { agentId: 'claude' }
    })
  })

  it('rejects unsafe prototype keys and invalid agent ids', () => {
    expect(
      normalizeSourceControlAiActionDefaults({
        __proto__: { agentId: 'codex' },
        constructor: { agentId: 'codex' },
        prototype: { agentId: 'codex' },
        fixCommitFailure: { agentId: 'not-real', commandInputTemplate: 42 }
      })
    ).toBeUndefined()
  })

  it('normalizes the custom command sentinel for text action recipes', () => {
    expect(
      normalizeSourceControlAiActionDefaults({
        pullRequest: {
          agentId: 'custom',
          commandInputTemplate: '{basePrompt}'
        }
      })
    ).toEqual({
      pullRequest: {
        agentId: 'custom',
        commandInputTemplate: '{basePrompt}'
      }
    })
  })

  it('trims command templates and CLI args only when reading them', () => {
    const defaults = normalizeSourceControlAiActionDefaults({
      fixCommitFailure: {
        agentId: 'claude',
        commandInputTemplate: '  {basePrompt}  ',
        agentArgs: '  --model sonnet  '
      }
    })

    expect(defaults?.fixCommitFailure?.commandInputTemplate).toBe('  {basePrompt}  ')
    expect(defaults?.fixCommitFailure?.agentArgs).toBe('  --model sonnet  ')
    expect(readSourceControlActionDefault(defaults, 'fixCommitFailure')).toEqual({
      agentId: 'claude',
      commandInputTemplate: '{basePrompt}',
      agentArgs: '--model sonnet'
    })
  })

  it('preserves explicitly empty command templates when resolving defaults', () => {
    expect(
      resolveSourceControlActionCommandTemplate(
        { fixCommitFailure: { commandInputTemplate: '' } },
        'fixCommitFailure'
      )
    ).toBe('')
    expect(resolveSourceControlActionCommandTemplate(undefined, 'fixCommitFailure')).toBe(
      '{basePrompt}'
    )
  })

  it('renders command template placeholders that start with underscores', () => {
    expect(
      renderSourceControlActionCommandTemplate('agent {_prompt} {{_context}}', {
        _prompt: 'PROMPT',
        _context: 'CONTEXT'
      })
    ).toBe('agent PROMPT CONTEXT')
  })

  it('sets agent defaults without dropping neighboring action defaults', () => {
    expect(
      setSourceControlActionAgentDefault(
        { fixChecks: { agentId: 'codex' } },
        'resolveConflicts',
        'claude'
      )
    ).toEqual({
      fixChecks: { agentId: 'codex' },
      resolveConflicts: { agentId: 'claude' }
    })
  })

  it('exposes review-comment resolution as a launch action', () => {
    expect(SOURCE_CONTROL_LAUNCH_ACTION_IDS).toContain('resolveComments')
    expect(SOURCE_CONTROL_LAUNCH_ACTION_LABELS.resolveComments).toBe('Review comment resolution')
    expect(resolveSourceControlActionCommandTemplate(undefined, 'resolveComments')).toBe(
      '{basePrompt}'
    )
    expect(SOURCE_CONTROL_ACTION_VARIABLES.resolveComments).toEqual(['basePrompt'])
  })

  it('exposes push failure recovery as a launch action with basePrompt defaults', () => {
    expect(SOURCE_CONTROL_LAUNCH_ACTION_IDS).toContain('fixPushFailure')
    expect(SOURCE_CONTROL_LAUNCH_ACTION_LABELS.fixPushFailure).toBe('Push failure fixes')
    expect(DEFAULT_SOURCE_CONTROL_ACTION_COMMAND_TEMPLATES.fixPushFailure).toBe('{basePrompt}')
    expect(resolveSourceControlActionCommandTemplate(undefined, 'fixPushFailure')).toBe(
      '{basePrompt}'
    )
    expect(SOURCE_CONTROL_ACTION_VARIABLES.fixPushFailure).toEqual(['basePrompt'])
    expect(
      normalizeSourceControlAiActionDefaults({
        fixPushFailure: {
          agentId: 'codex',
          commandInputTemplate: '{basePrompt}',
          agentArgs: '--model gpt-5.4-mini'
        }
      })
    ).toEqual({
      fixPushFailure: {
        agentId: 'codex',
        commandInputTemplate: '{basePrompt}',
        agentArgs: '--model gpt-5.4-mini'
      }
    })
  })

  it('renders known template variables and leaves unknown variables visible', () => {
    expect(
      renderSourceControlActionCommandTemplate('fix {thing} with {missing}', {
        thing: 'CI'
      })
    ).toBe('fix CI with {missing}')
  })

  it('leaves inherited prototype names visible instead of rendering function source', () => {
    expect(
      renderSourceControlActionCommandTemplate('use {constructor} and {toString}', {
        thing: 'CI'
      })
    ).toBe('use {constructor} and {toString}')
  })
})

describe('source-control AI variable registry', () => {
  it('documents every registered variable so chip hover cards cannot crash', () => {
    const undocumented = [...new Set(Object.values(SOURCE_CONTROL_ACTION_VARIABLES).flat())].filter(
      (variable) => SOURCE_CONTROL_ACTION_VARIABLE_INFO[variable] === undefined
    )

    expect(undocumented).toEqual([])
  })

  it('offers linkedIssue on commit message and pull request only', () => {
    expect(SOURCE_CONTROL_ACTION_VARIABLES.commitMessage).toContain('linkedIssue')
    expect(SOURCE_CONTROL_ACTION_VARIABLES.pullRequest).toContain('linkedIssue')
    expect(SOURCE_CONTROL_ACTION_VARIABLES.branchName).not.toContain('linkedIssue')
    for (const actionId of SOURCE_CONTROL_LAUNCH_ACTION_IDS) {
      expect(SOURCE_CONTROL_ACTION_VARIABLES[actionId]).not.toContain('linkedIssue')
    }
  })

  it('names GitHub and the empty case in the linkedIssue description', () => {
    const info = SOURCE_CONTROL_ACTION_VARIABLE_INFO.linkedIssue
    expect(info.description).toContain('GitHub')
    expect(info.description).toContain('Empty')
    expect(info.example).toBe('123')
  })
})

describe('formatLinkedIssueTemplateValue', () => {
  it('renders finite numbers as decimal strings', () => {
    expect(formatLinkedIssueTemplateValue(123)).toBe('123')
    expect(formatLinkedIssueTemplateValue(0)).toBe('0')
    expect(formatLinkedIssueTemplateValue(-7)).toBe('-7')
    expect(formatLinkedIssueTemplateValue(12.9)).toBe('12')
  })

  it('renders missing and non-finite values as an empty string', () => {
    expect(formatLinkedIssueTemplateValue(null)).toBe('')
    expect(formatLinkedIssueTemplateValue(undefined)).toBe('')
    expect(formatLinkedIssueTemplateValue(Number.NaN)).toBe('')
    expect(formatLinkedIssueTemplateValue(Number.POSITIVE_INFINITY)).toBe('')
  })

  it('expands both brace forms and never leaves the token literal', () => {
    const template = 'Fixes #{linkedIssue} / {{ linkedIssue }}'
    expect(
      renderSourceControlActionCommandTemplate(template, {
        linkedIssue: formatLinkedIssueTemplateValue(42)
      })
    ).toBe('Fixes #42 / 42')
    expect(
      renderSourceControlActionCommandTemplate(template, {
        linkedIssue: formatLinkedIssueTemplateValue(null)
      })
    ).toBe('Fixes # / ')
  })
})

describe('withLinkedIssueDraftContext', () => {
  it('attaches only finite numbers and leaves the context untouched otherwise', () => {
    const context = { branch: 'main', stagedSummary: 'M a.ts', stagedPatch: 'diff' }

    expect(withLinkedIssueDraftContext(context, 42)).toEqual({ ...context, linkedIssue: 42 })
    expect(withLinkedIssueDraftContext(context, null)).toBe(context)
    expect(withLinkedIssueDraftContext(context, undefined)).toBe(context)
    expect(withLinkedIssueDraftContext(context, Number.NaN)).toBe(context)
  })
})
