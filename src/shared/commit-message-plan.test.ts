import { describe, expect, it } from 'vitest'
import { planCommitMessageGeneration } from './commit-message-plan'

describe('planCommitMessageGeneration', () => {
  it('plans Claude non-interactive generation with the prompt on stdin only', () => {
    const result = planCommitMessageGeneration(
      {
        agentId: 'claude',
        model: 'sonnet',
        thinkingLevel: 'high'
      },
      'PROMPT'
    )

    expect(result).toEqual({
      ok: true,
      plan: {
        binary: 'claude',
        args: [
          '-p',
          '--output-format',
          'text',
          '--model',
          'sonnet',
          '--permission-mode',
          'plan',
          '--effort',
          'high'
        ],
        stdinPayload: 'PROMPT',
        label: 'Claude'
      }
    })
  })

  it('plans OpenCode run with prompt on stdin and model variant', () => {
    const result = planCommitMessageGeneration(
      {
        agentId: 'opencode',
        model: 'opencode/gpt-5.4-mini',
        thinkingLevel: 'high'
      },
      'PROMPT'
    )

    expect(result).toEqual({
      ok: true,
      plan: {
        binary: 'opencode',
        args: [
          'run',
          '--model',
          'opencode/gpt-5.4-mini',
          '--agent',
          'build',
          '--format',
          'default',
          '--variant',
          'high'
        ],
        stdinPayload: 'PROMPT',
        label: 'OpenCode'
      }
    })
  })

  it('keeps OpenCode preset command overrides while sending the prompt on stdin', () => {
    const result = planCommitMessageGeneration(
      {
        agentId: 'opencode',
        model: 'opencode/gpt-5.4-mini',
        agentCommandOverride: 'npx opencode'
      },
      'PROMPT'
    )

    expect(result).toEqual({
      ok: true,
      plan: {
        binary: 'npx',
        args: [
          'opencode',
          'run',
          '--model',
          'opencode/gpt-5.4-mini',
          '--agent',
          'build',
          '--format',
          'default'
        ],
        stdinPayload: 'PROMPT',
        label: 'OpenCode'
      }
    })
  })

  it('plans Amp execute generation without the removed archive flag', () => {
    const result = planCommitMessageGeneration(
      {
        agentId: 'amp',
        model: 'large',
        thinkingLevel: 'medium'
      },
      'PROMPT'
    )

    expect(result).toEqual({
      ok: true,
      plan: {
        binary: 'amp',
        args: [
          '--execute',
          '--no-notifications',
          '--no-ide',
          '--no-jetbrains',
          '--mode',
          'large',
          '--effort',
          'medium'
        ],
        stdinPayload: 'PROMPT',
        label: 'Amp'
      }
    })
  })

  it('allows discovered dynamic models that are not in the seed catalog', () => {
    const result = planCommitMessageGeneration(
      {
        agentId: 'cursor',
        model: 'gpt-5.2',
        thinkingLevel: 'xhigh'
      },
      'PROMPT'
    )

    expect(result).toEqual({
      ok: true,
      plan: {
        binary: 'cursor-agent',
        args: [
          '--print',
          '--mode',
          'ask',
          '--trust',
          '--output-format',
          'text',
          '--model',
          'gpt-5.2',
          'PROMPT'
        ],
        stdinPayload: null,
        label: 'Cursor'
      }
    })
  })

  it('plans Codex exec as non-interactive read-only generation with the prompt on stdin only', () => {
    const result = planCommitMessageGeneration(
      {
        agentId: 'codex',
        model: 'gpt-5.4-mini',
        thinkingLevel: 'medium'
      },
      'PROMPT'
    )

    expect(result).toEqual({
      ok: true,
      plan: {
        binary: 'codex',
        args: [
          'exec',
          '--ephemeral',
          '--skip-git-repo-check',
          '-s',
          'read-only',
          '--model',
          'gpt-5.4-mini',
          '-c',
          'model_reasoning_effort=medium'
        ],
        stdinPayload: 'PROMPT',
        label: 'Codex'
      }
    })
  })

  it('uses preset agent command overrides as the spawn command prefix', () => {
    const result = planCommitMessageGeneration(
      {
        agentId: 'codex',
        model: 'gpt-5.4-mini',
        agentCommandOverride: 'npx codex'
      },
      'PROMPT'
    )

    expect(result).toMatchObject({
      ok: true,
      plan: {
        binary: 'npx',
        args: [
          'codex',
          'exec',
          '--ephemeral',
          '--skip-git-repo-check',
          '-s',
          'read-only',
          '--model',
          'gpt-5.4-mini'
        ],
        stdinPayload: 'PROMPT'
      }
    })
  })

  it.each([
    ['long option', '--model gpt-5.6-luna', ['--model', 'gpt-5.6-luna'], []],
    ['short option', '-m gpt-5.6-luna', ['-m', 'gpt-5.6-luna'], []],
    ['equals form', '--model=gpt-5.6-luna', ['--model=gpt-5.6-luna'], []],
    ['attached short form', '-mgpt-5.6-luna', ['-mgpt-5.6-luna'], []],
    [
      'sibling arguments',
      '--model gpt-5.6-luna --sandbox read-only',
      ['--model', 'gpt-5.6-luna'],
      ['--sandbox', 'read-only']
    ]
  ])(
    'lets Codex recipe args override the generated model via %s',
    (_, agentArgs, overrideArgs, trailingArgs) => {
      const result = planCommitMessageGeneration(
        { agentId: 'codex', model: 'gpt-5.4-mini', thinkingLevel: 'medium', agentArgs },
        'PROMPT'
      )

      expect(result).toMatchObject({
        ok: true,
        plan: {
          args: [
            'exec',
            '--ephemeral',
            '--skip-git-repo-check',
            '-s',
            'read-only',
            ...overrideArgs,
            '-c',
            'model_reasoning_effort=medium',
            ...trailingArgs
          ],
          stdinPayload: 'PROMPT'
        }
      })
    }
  )

  it('keeps Codex recipe arguments unchanged when they do not override the model', () => {
    const result = planCommitMessageGeneration(
      {
        agentId: 'codex',
        model: 'gpt-5.4-mini',
        agentArgs: '--sandbox workspace-write'
      },
      'PROMPT'
    )

    expect(result).toMatchObject({
      ok: true,
      plan: {
        args: [
          'exec',
          '--ephemeral',
          '--skip-git-repo-check',
          '-s',
          'read-only',
          '--model',
          'gpt-5.4-mini',
          '--sandbox',
          'workspace-write'
        ]
      }
    })
  })

  it('keeps the generated Codex model when model-like text follows an option terminator', () => {
    const result = planCommitMessageGeneration(
      {
        agentId: 'codex',
        model: 'gpt-5.4-mini',
        agentArgs: '-- --model literal'
      },
      'PROMPT'
    )

    expect(result).toMatchObject({
      ok: true,
      plan: {
        args: [
          'exec',
          '--ephemeral',
          '--skip-git-repo-check',
          '-s',
          'read-only',
          '--model',
          'gpt-5.4-mini',
          '--',
          '--model',
          'literal'
        ]
      }
    })
  })

  it.each([
    ['long option', '--model opencode/gpt-5.5', ['--model', 'opencode/gpt-5.5'], []],
    ['short option', '-m opencode/gpt-5.5', ['-m', 'opencode/gpt-5.5'], []],
    ['equals form', '--model=opencode/gpt-5.5', ['--model=opencode/gpt-5.5'], []],
    ['short equals form', '-m=opencode/gpt-5.5', ['-m=opencode/gpt-5.5'], []],
    [
      'sibling arguments',
      '--model opencode/gpt-5.5 --log-level warn',
      ['--model', 'opencode/gpt-5.5'],
      ['--log-level', 'warn']
    ],
    [
      'quoted model with spaces',
      '--model "provider/my model"',
      ['--model', 'provider/my model'],
      []
    ]
  ])(
    'lets OpenCode recipe args override the generated model via %s',
    (_, agentArgs, overrideArgs, trailingArgs) => {
      const result = planCommitMessageGeneration(
        {
          agentId: 'opencode',
          model: 'opencode/gpt-5.4-mini',
          thinkingLevel: 'high',
          agentArgs
        },
        'PROMPT'
      )

      expect(result).toMatchObject({
        ok: true,
        plan: {
          args: [
            'run',
            ...overrideArgs,
            '--agent',
            'build',
            '--format',
            'default',
            '--variant',
            'high',
            ...trailingArgs
          ],
          stdinPayload: 'PROMPT'
        }
      })
    }
  )

  it('keeps only the last repeated OpenCode recipe model option', () => {
    const result = planCommitMessageGeneration(
      {
        agentId: 'opencode',
        model: 'opencode/gpt-5.4-mini',
        thinkingLevel: 'high',
        agentArgs:
          '--log-level warn --model provider/first -m provider/second --model=provider/final --verbose'
      },
      'PROMPT'
    )

    expect(result).toMatchObject({
      ok: true,
      plan: {
        args: [
          'run',
          '--model=provider/final',
          '--agent',
          'build',
          '--format',
          'default',
          '--variant',
          'high',
          '--log-level',
          'warn',
          '--verbose'
        ]
      }
    })
  })

  it('keeps OpenCode recipe arguments that do not override the model', () => {
    const result = planCommitMessageGeneration(
      {
        agentId: 'opencode',
        model: 'opencode/gpt-5.4-mini',
        agentArgs: '--log-level warn'
      },
      'PROMPT'
    )

    expect(result).toMatchObject({
      ok: true,
      plan: {
        args: [
          'run',
          '--model',
          'opencode/gpt-5.4-mini',
          '--agent',
          'build',
          '--format',
          'default',
          '--log-level',
          'warn'
        ],
        stdinPayload: 'PROMPT'
      }
    })
  })

  it('normalizes only OpenCode model options before an option terminator', () => {
    const result = planCommitMessageGeneration(
      {
        agentId: 'opencode',
        model: 'opencode/gpt-5.4-mini',
        agentArgs: '-m provider/before -- --model literal -mprovider/after "value with spaces"'
      },
      'PROMPT'
    )

    expect(result).toMatchObject({
      ok: true,
      plan: {
        args: [
          'run',
          '-m',
          'provider/before',
          '--agent',
          'build',
          '--format',
          'default',
          '--',
          '--model',
          'literal',
          '-mprovider/after',
          'value with spaces'
        ]
      }
    })
  })

  it.each([
    '--model',
    '-m',
    '--model=',
    '-m=',
    '--model ""',
    '-mprovider/model',
    '--model --verbose'
  ])('rejects malformed OpenCode model recipe args: %s', (agentArgs) => {
    const result = planCommitMessageGeneration(
      { agentId: 'opencode', model: 'opencode/gpt-5.4-mini', agentArgs },
      'PROMPT'
    )

    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining('OpenCode model option')
    })
  })

  it('appends non-model per-action CLI arguments for stdin agents that do not override model', () => {
    const result = planCommitMessageGeneration(
      {
        agentId: 'claude',
        model: 'sonnet',
        agentArgs: '--verbose'
      },
      'PROMPT'
    )

    expect(result).toMatchObject({
      ok: true,
      plan: {
        args: [
          '-p',
          '--output-format',
          'text',
          '--model',
          'sonnet',
          '--permission-mode',
          'plan',
          '--verbose'
        ],
        stdinPayload: 'PROMPT'
      }
    })
  })

  it('keeps custom per-action CLI arguments before a positional prompt', () => {
    const result = planCommitMessageGeneration(
      {
        agentId: 'custom',
        model: '',
        customAgentCommand: 'agent --message {prompt}',
        agentArgs: '--model gpt-5.5'
      },
      'PROMPT'
    )

    expect(result).toEqual({
      ok: true,
      plan: {
        binary: 'agent',
        args: ['--message', '--model', 'gpt-5.5', 'PROMPT'],
        stdinPayload: null,
        label: 'agent'
      }
    })
  })

  it('appends custom per-action CLI arguments when the prompt is sent on stdin', () => {
    const result = planCommitMessageGeneration(
      {
        agentId: 'custom',
        model: '',
        customAgentCommand: 'agent --message',
        agentArgs: '--model gpt-5.5'
      },
      'PROMPT'
    )

    expect(result).toMatchObject({
      ok: true,
      plan: {
        args: ['--message', '--model', 'gpt-5.5'],
        stdinPayload: 'PROMPT'
      }
    })
  })

  it('rejects invalid per-action CLI arguments before spawning', () => {
    const result = planCommitMessageGeneration(
      {
        agentId: 'claude',
        model: 'haiku',
        agentArgs: '--model "unterminated'
      },
      'PROMPT'
    )

    expect(result).toEqual({
      ok: false,
      error: 'CLI arguments are invalid: Unclosed quote in command template.'
    })
  })

  it('rejects invalid preset agent command overrides before spawning', () => {
    const result = planCommitMessageGeneration(
      {
        agentId: 'claude',
        model: 'haiku',
        agentCommandOverride: 'claude "unterminated'
      },
      'PROMPT'
    )

    expect(result).toEqual({
      ok: false,
      error: 'Agent command override is invalid: Unclosed quote in command template.'
    })
  })
})
