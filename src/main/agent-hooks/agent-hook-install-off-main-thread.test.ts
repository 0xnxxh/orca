import type * as NodeFsModule from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import type * as NodeFsPromisesModule from 'node:fs/promises'
import { tmpdir } from 'node:os'
import type * as NodeOsModule from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createManagedCommandMatcher,
  MANAGED_HOOK_TIMEOUT_MILLISECONDS,
  type HookDefinition,
  type HooksConfig
} from './installer-utils'

// Why: a stalled SMB/NFS HOME turns any *Sync fs call on the Electron main
// thread into an uninterruptible wait — the app stops repainting and Force Quit
// stops working. These tests fail if the agent-hook install path regains one.
const state = vi.hoisted(() => ({
  home: '',
  syncCalls: [] as { name: string; target: string }[],
  blockAsyncFs: false
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFsModule>()
  const wrapped: Record<string, unknown> = { ...actual }
  for (const [name, value] of Object.entries(actual)) {
    if (!name.endsWith('Sync') || typeof value !== 'function') {
      continue
    }
    const original = value as ((...args: unknown[]) => unknown) & Record<string, unknown>
    const recorder = (...args: unknown[]): unknown => {
      state.syncCalls.push({ name, target: typeof args[0] === 'string' ? args[0] : '' })
      return original(...args)
    }
    // Why: realpathSync.native is a property of the function; a bare spread drops it.
    Object.assign(recorder, original)
    wrapped[name] = recorder
  }
  return { ...wrapped, default: wrapped }
})

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFsPromisesModule>()
  return {
    ...actual,
    default: actual,
    readFile: (...args: Parameters<typeof actual.readFile>) =>
      state.blockAsyncFs ? new Promise<never>(() => {}) : actual.readFile(...args)
  }
})

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeOsModule>()
  const patched = { ...actual, homedir: () => state.home }
  return { ...patched, default: patched }
})

function syncCallsUnder(...dirs: string[]): string[] {
  return state.syncCalls
    .filter((call) => dirs.some((dir) => call.target.startsWith(dir)))
    .map((call) => `${call.name}(${call.target})`)
}

describe('agent hook install stays off the main thread', () => {
  beforeEach(async () => {
    state.home = await mkdtemp(join(tmpdir(), 'orca-agent-hooks-'))
    state.blockAsyncFs = false
    state.syncCalls = []
  })

  afterEach(async () => {
    state.blockAsyncFs = false
    await rm(state.home, { recursive: true, force: true })
  })

  it('installs the Gemini managed hook with no synchronous fs call under HOME', async () => {
    const { geminiHookService } = await import('../gemini/hook-service')
    state.syncCalls = []

    const status = await geminiHookService.installAsync()

    expect(status.state).toBe('installed')
    expect(syncCallsUnder(join(state.home, '.gemini'), join(state.home, '.orca'))).toEqual([])
    const written = JSON.parse(
      await readFile(join(state.home, '.gemini', 'settings.json'), 'utf-8')
    )
    expect(Object.keys(written.hooks)).toContain('AfterTool')
  })

  it('reports status with no synchronous fs call under HOME', async () => {
    const { claudeHookService } = await import('../claude/hook-service')
    state.syncCalls = []

    const status = await claudeHookService.getStatusAsync()

    expect(status.state).toBe('not_installed')
    expect(syncCallsUnder(join(state.home, '.claude'))).toEqual([])
  })

  it('keeps the event loop alive while the hooks read is stuck', async () => {
    const { geminiHookService } = await import('../gemini/hook-service')
    state.blockAsyncFs = true

    const install = geminiHookService.installAsync()
    let settled = false
    void install.then(() => {
      settled = true
    })

    const timerFired = await new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(true), 5)
    })

    expect(timerFired).toBe(true)
    expect(settled).toBe(false)
  })
})

type AsyncHookService = {
  installAsync: () => Promise<{ state: string }>
  removeAsync: () => Promise<{ state: string }>
  getStatusAsync: () => Promise<{ state: string }>
}

// Why: every managed agent funnels through the same reader/writer pair, so one
// service keeping a stray *Sync probe reintroduces the whole freeze class.
const ASYNC_HOOK_SERVICES: readonly [string, () => Promise<AsyncHookService>][] = [
  ['claude', async () => (await import('../claude/hook-service')).claudeHookService],
  ['openclaude', async () => (await import('../openclaude/hook-service')).openClaudeHookService],
  ['gemini', async () => (await import('../gemini/hook-service')).geminiHookService],
  ['antigravity', async () => (await import('../antigravity/hook-service')).antigravityHookService],
  ['cursor', async () => (await import('../cursor/hook-service')).cursorHookService],
  ['droid', async () => (await import('../droid/hook-service')).droidHookService],
  [
    'command-code',
    async () => (await import('../command-code/hook-service')).commandCodeHookService
  ],
  ['copilot', async () => (await import('../copilot/hook-service')).copilotHookService],
  ['grok', async () => (await import('../grok/hook-service')).grokHookService]
]

describe.each(ASYNC_HOOK_SERVICES)('%s managed hooks', (_agent, load) => {
  beforeEach(async () => {
    state.home = await mkdtemp(join(tmpdir(), 'orca-agent-hooks-'))
    state.blockAsyncFs = false
    state.syncCalls = []
  })

  afterEach(async () => {
    state.blockAsyncFs = false
    await rm(state.home, { recursive: true, force: true })
  })

  it('runs status, install and remove with no synchronous fs call under HOME', async () => {
    const service = await load()
    state.syncCalls = []

    expect((await service.getStatusAsync()).state).toBe('not_installed')
    expect((await service.installAsync()).state).toBe('installed')
    expect((await service.removeAsync()).state).toBe('not_installed')

    expect(syncCallsUnder(state.home)).toEqual([])
  })
})

// Why: the *Async twins are the only ones production calls, but the merge/sweep
// rules were only ever asserted against the sync twins. Re-assert the semantics
// (user entries preserved, stale managed entries swept, retired buckets dropped,
// repeat installs idempotent) on the path the app actually runs.
const CURSOR_EVENTS = [
  'beforeSubmitPrompt',
  'stop',
  'preToolUse',
  'postToolUse',
  'postToolUseFailure',
  'beforeShellExecution',
  'beforeMCPExecution',
  'afterAgentResponse'
]
const GEMINI_EVENTS = ['BeforeAgent', 'AfterAgent', 'AfterTool', 'BeforeTool']
const CLAUDE_MATCHER_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest'
]
const CLAUDE_EVENT_NAMES = [
  'UserPromptSubmit',
  'Stop',
  'StopFailure',
  'SubagentStart',
  'SubagentStop',
  'TeammateIdle',
  ...CLAUDE_MATCHER_EVENTS
]

const STALE_MANAGED = (scriptStem: string): string => `/old/path/.orca/agent-hooks/${scriptStem}.sh`

async function seedConfig(dirName: string, config: unknown): Promise<string> {
  const configPath = join(state.home, dirName, 'settings.json')
  await mkdir(join(state.home, dirName), { recursive: true })
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8')
  return configPath
}

async function readConfig(configPath: string): Promise<HooksConfig> {
  return JSON.parse(await readFile(configPath, 'utf-8')) as HooksConfig
}

// Why: nested (`hooks[].command`) and top-level (`definition.command`) shapes both
// ship; the oracle has to see either, exactly as the installers' matcher does.
function commandsOf(definitions: HookDefinition[] | undefined): string[] {
  return (definitions ?? []).flatMap((definition) => [
    ...(typeof definition.command === 'string' ? [definition.command] : []),
    ...(definition.hooks ?? []).map((hook) => hook.command)
  ])
}

function managedCommandsOf(definitions: HookDefinition[] | undefined, stem: string): string[] {
  const isManaged = createManagedCommandMatcher(`${stem}.sh`)
  return commandsOf(definitions).filter((command) => isManaged(command))
}

describe('async agent hook twins keep the documented merge and sweep rules', () => {
  beforeEach(async () => {
    state.home = await mkdtemp(join(tmpdir(), 'orca-agent-hooks-'))
    state.blockAsyncFs = false
    state.syncCalls = []
  })

  afterEach(async () => {
    state.blockAsyncFs = false
    await rm(state.home, { recursive: true, force: true })
  })

  it('cursor installAsync keeps user entries, converges managed ones and drops retired buckets', async () => {
    const configPath = join(state.home, '.cursor', 'hooks.json')
    await mkdir(join(state.home, '.cursor'), { recursive: true })
    await writeFile(
      configPath,
      `${JSON.stringify({
        hooks: {
          beforeSubmitPrompt: [
            { command: '/usr/local/bin/user-hook' },
            { command: STALE_MANAGED('cursor-hook') },
            { hooks: [{ type: 'command', command: STALE_MANAGED('cursor-hook') }] }
          ],
          retiredEvent: [{ command: STALE_MANAGED('cursor-hook') }],
          keptEvent: [
            { command: STALE_MANAGED('cursor-hook') },
            { command: '/usr/local/bin/kept-user-hook' }
          ]
        }
      })}\n`,
      'utf-8'
    )
    const { cursorHookService } = await import('../cursor/hook-service')
    state.syncCalls = []

    expect((await cursorHookService.installAsync()).state).toBe('installed')
    expect((await cursorHookService.installAsync()).state).toBe('installed')

    const config = await readConfig(configPath)
    const hooks = config.hooks!
    // Why: cursor-agent rejects a hooks.json without the top-level version.
    expect(config.version).toBe(1)
    expect(Object.keys(hooks).sort()).toEqual([...CURSOR_EVENTS, 'keptEvent'].sort())
    for (const eventName of CURSOR_EVENTS) {
      expect(managedCommandsOf(hooks[eventName], 'cursor-hook'), eventName).toHaveLength(1)
      // Cursor's schema puts `command` on the definition, not under `hooks`.
      expect(hooks[eventName]!.at(-1)!.hooks, eventName).toBeUndefined()
      expect(typeof hooks[eventName]!.at(-1)!.command, eventName).toBe('string')
    }
    expect(commandsOf(hooks.beforeSubmitPrompt)).toContain('/usr/local/bin/user-hook')
    expect(commandsOf(hooks.keptEvent)).toEqual(['/usr/local/bin/kept-user-hook'])

    expect((await cursorHookService.removeAsync()).state).toBe('not_installed')
    const afterRemove = await readConfig(configPath)
    expect(commandsOf(afterRemove.hooks!.beforeSubmitPrompt)).toEqual(['/usr/local/bin/user-hook'])
    expect(managedCommandsOf(afterRemove.hooks!.beforeSubmitPrompt, 'cursor-hook')).toEqual([])
    expect(syncCallsUnder(state.home)).toEqual([])
  })

  it('gemini installAsync appends one managed entry per live event and sweeps retired ones', async () => {
    const configPath = await seedConfig('.gemini', {
      theme: 'dark',
      hooks: {
        AfterTool: [{ hooks: [{ type: 'command', command: '/usr/local/bin/user-gemini-hook' }] }],
        PreToolUse: [{ hooks: [{ type: 'command', command: STALE_MANAGED('gemini-hook') }] }]
      }
    })
    const { geminiHookService } = await import('../gemini/hook-service')
    state.syncCalls = []

    expect((await geminiHookService.installAsync()).state).toBe('installed')
    expect((await geminiHookService.installAsync()).state).toBe('installed')

    const config = await readConfig(configPath)
    const hooks = config.hooks!
    expect(config.theme).toBe('dark')
    expect(Object.keys(hooks).sort()).toEqual([...GEMINI_EVENTS].sort())
    for (const eventName of GEMINI_EVENTS) {
      expect(managedCommandsOf(hooks[eventName], 'gemini-hook'), eventName).toHaveLength(1)
      // Why: Gemini's hook timeout is milliseconds, unlike Claude/Codex.
      expect(hooks[eventName]!.at(-1)!.hooks![0].timeout, eventName).toBe(
        MANAGED_HOOK_TIMEOUT_MILLISECONDS
      )
    }
    // User definition stays first; the managed one is appended.
    expect(commandsOf(hooks.AfterTool)[0]).toBe('/usr/local/bin/user-gemini-hook')

    expect((await geminiHookService.removeAsync()).state).toBe('not_installed')
    const afterRemove = await readConfig(configPath)
    expect(commandsOf(afterRemove.hooks!.AfterTool)).toEqual(['/usr/local/bin/user-gemini-hook'])
    expect(afterRemove.hooks!.BeforeAgent).toBeUndefined()
    expect(syncCallsUnder(state.home)).toEqual([])
  })

  it('claude installAsync preserves matchers, user hooks and a user-owned statusLine', async () => {
    const configPath = await seedConfig('.claude', {
      hooks: {
        Stop: [
          { hooks: [{ type: 'command', command: '/usr/local/bin/user-stop-hook' }] },
          { hooks: [{ type: 'command', command: STALE_MANAGED('claude-hook') }] }
        ]
      },
      statusLine: { type: 'command', command: '/usr/local/bin/user-statusline' }
    })
    const { claudeHookService } = await import('../claude/hook-service')
    state.syncCalls = []

    expect((await claudeHookService.installAsync()).state).toBe('installed')
    expect((await claudeHookService.installAsync()).state).toBe('installed')

    const config = await readConfig(configPath)
    const hooks = config.hooks!
    expect(Object.keys(hooks).sort()).toEqual([...CLAUDE_EVENT_NAMES].sort())
    for (const eventName of CLAUDE_EVENT_NAMES) {
      expect(managedCommandsOf(hooks[eventName], 'claude-hook'), eventName).toHaveLength(1)
      expect(hooks[eventName]!.at(-1)!.matcher, eventName).toBe(
        CLAUDE_MATCHER_EVENTS.includes(eventName) ? '*' : undefined
      )
    }
    expect(commandsOf(hooks.Stop)[0]).toBe('/usr/local/bin/user-stop-hook')
    // Why: the statusline slot is single-valued — a user-owned command is never replaced.
    expect((config.statusLine as { command: string }).command).toBe(
      '/usr/local/bin/user-statusline'
    )

    expect((await claudeHookService.removeAsync()).state).toBe('not_installed')
    const afterRemove = await readConfig(configPath)
    expect(commandsOf(afterRemove.hooks!.Stop)).toEqual(['/usr/local/bin/user-stop-hook'])
    expect((afterRemove.statusLine as { command: string }).command).toBe(
      '/usr/local/bin/user-statusline'
    )
    expect(syncCallsUnder(state.home)).toEqual([])
  })

  it('claude installAsync claims an empty statusLine slot and removeAsync gives it back', async () => {
    const configPath = await seedConfig('.claude', { hooks: {} })
    const { claudeHookService } = await import('../claude/hook-service')
    state.syncCalls = []

    expect((await claudeHookService.installAsync()).state).toBe('installed')

    const config = await readConfig(configPath)
    const statusLineCommand = (config.statusLine as { command: string }).command
    expect(createManagedCommandMatcher('claude-statusline.sh')(statusLineCommand)).toBe(true)

    expect((await claudeHookService.removeAsync()).state).toBe('not_installed')
    expect((await readConfig(configPath)).statusLine).toBeUndefined()
    expect(syncCallsUnder(state.home)).toEqual([])
  })
})
