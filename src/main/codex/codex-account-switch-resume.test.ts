import { describe, expect, it } from 'vitest'
import type { CodexManagedAccount } from '../../shared/types'
import { CodexAppServerCapabilityCache } from './codex-app-server-capability-cache'
import {
  CodexAppServerUnsupportedError,
  type CodexAppServerInvocation,
  type CodexAppServerRpc,
  type runCodexAppServerSession
} from './codex-app-server-session'
import {
  CODEX_GOAL_RPC_HOST_KEY,
  prepareCodexAccountSwitchResume,
  resolveCodexAccountSwitchHomes,
  type CodexAccountSwitchHomes,
  type PrepareCodexAccountSwitchResumeDeps
} from './codex-account-switch-resume'
import type { CodexPaneAccountRecord } from './codex-pane-account-registry'

const THREAD_ID = '123e4567-e89b-42d3-a456-426614174000'
const OLD_HOME = '/managed/account-a/home'
const NEW_HOME = '/managed/account-b/home'
const SYSTEM_HOME = '/users/dev/.codex'
const SHARED_HOME = '/orca/codex-runtime-home'
const ACCOUNTS_ROOT = '/managed'

function managedAccount(overrides: Partial<CodexManagedAccount> = {}): CodexManagedAccount {
  return {
    id: 'account-a',
    email: 'a@example.com',
    managedHomePath: OLD_HOME,
    createdAt: 1,
    updatedAt: 1,
    lastAuthenticatedAt: 1,
    ...overrides
  }
}

function hostRecord(overrides: Partial<CodexPaneAccountRecord> = {}): CodexPaneAccountRecord {
  return { selectionKey: 'host', accountId: 'account-a', homeRoute: 'account-home', ...overrides }
}

function resolveHomes(args: {
  record: CodexPaneAccountRecord | null
  accounts?: CodexManagedAccount[]
  selectedHostAccountCodexHomePath?: string | null
  hostSystemDefaultRealHome?: boolean
  assertOwnedManagedHome?: () => string
}): ReturnType<typeof resolveCodexAccountSwitchHomes> {
  return resolveCodexAccountSwitchHomes({
    record: args.record,
    settings: { codexManagedAccounts: args.accounts ?? [managedAccount()] },
    managedAccountsRoot: ACCOUNTS_ROOT,
    systemCodexHomePath: SYSTEM_HOME,
    sharedRuntimeCodexHomePath: SHARED_HOME,
    selectedHostAccountCodexHomePath:
      args.selectedHostAccountCodexHomePath === undefined
        ? NEW_HOME
        : args.selectedHostAccountCodexHomePath,
    hostSystemDefaultRealHome: args.hostSystemDefaultRealHome ?? false,
    assertOwnedManagedHome: args.assertOwnedManagedHome ?? (() => OLD_HOME)
  })
}

describe('resolveCodexAccountSwitchHomes', () => {
  it('resolves account-home to new-selection homes for a recorded host pane', () => {
    expect(resolveHomes({ record: hostRecord() })).toEqual({
      outcome: 'homes',
      homes: { oldCodexHomePath: OLD_HOME, newCodexHomePath: NEW_HOME }
    })
  })

  it('resolves a real-home launch and a system-default new selection', () => {
    expect(
      resolveHomes({
        record: hostRecord({ accountId: null, homeRoute: 'real-home' }),
        selectedHostAccountCodexHomePath: null,
        hostSystemDefaultRealHome: true
      })
    ).toEqual({
      outcome: 'homes',
      homes: { oldCodexHomePath: SYSTEM_HOME, newCodexHomePath: SYSTEM_HOME }
    })
  })

  it('resolves the legacy shared mirror on both sides when no lane routes elsewhere', () => {
    expect(
      resolveHomes({
        record: hostRecord({ homeRoute: 'shared-home' }),
        selectedHostAccountCodexHomePath: null
      })
    ).toEqual({
      outcome: 'homes',
      homes: { oldCodexHomePath: SHARED_HOME, newCodexHomePath: SHARED_HOME }
    })
  })

  it.each([
    ['unrecorded pane', null, 'pane-launch-unrecorded'],
    ['WSL lane', hostRecord({ selectionKey: 'wsl:Ubuntu' }), 'non-host-lane'],
    [
      'shell-startup home override',
      hostRecord({
        shellStartupHomeOverride: { home: '/users/dev', codexHome: '/custom' }
      }),
      'custom-home-override'
    ],
    [
      'environment home override',
      hostRecord({ environmentHomeOverride: { codexHome: '/custom' } }),
      'custom-home-override'
    ],
    ['custom-home route', hostRecord({ homeRoute: 'custom-home' }), 'unattributable-home-route'],
    ['wsl-home route', hostRecord({ homeRoute: 'wsl-home' }), 'unattributable-home-route'],
    [
      'record without route provenance',
      hostRecord({ homeRoute: undefined }),
      'unattributable-home-route'
    ],
    ['removed launch account', hostRecord({ accountId: 'gone' }), 'launch-account-removed']
  ] as const)('declines with fresh on %s', (_label, record, reason) => {
    expect(resolveHomes({ record: record as CodexPaneAccountRecord | null })).toEqual({
      outcome: 'fresh',
      reason
    })
  })

  it('declines when a WSL account owns the recorded account id', () => {
    expect(
      resolveHomes({
        record: hostRecord(),
        accounts: [managedAccount({ managedHomeRuntime: 'wsl', wslDistro: 'Ubuntu' })]
      })
    ).toEqual({ outcome: 'fresh', reason: 'launch-account-removed' })
  })

  it('declines when the recorded managed home fails the ownership check', () => {
    expect(
      resolveHomes({
        record: hostRecord(),
        assertOwnedManagedHome: () => {
          throw new Error('escapes the managed root')
        }
      })
    ).toEqual({ outcome: 'fresh', reason: 'untrusted-managed-home' })
  })
})

type RecordedCall = { home: string; method: string; params: Record<string, unknown> | undefined }

function createFakeSessionRunner(script: (call: RecordedCall) => unknown): {
  runner: typeof runCodexAppServerSession
  calls: RecordedCall[]
} {
  const calls: RecordedCall[] = []
  const runner = (async <T>(
    invocation: CodexAppServerInvocation,
    body: (rpc: CodexAppServerRpc) => Promise<T>
  ): Promise<T> => {
    const home = invocation.env?.CODEX_HOME ?? ''
    return body({
      request: async (method, params) => {
        const call = { home, method, params }
        calls.push(call)
        return script(call)
      },
      notify: () => {}
    })
  }) as typeof runCodexAppServerSession
  return { runner, calls }
}

const CROSS_HOME: CodexAccountSwitchHomes = {
  oldCodexHomePath: OLD_HOME,
  newCodexHomePath: NEW_HOME
}

function prepareDeps(args: {
  script: (call: RecordedCall) => unknown
  homes?: CodexAccountSwitchHomes
  bridged?: boolean
  cache?: CodexAppServerCapabilityCache
  nowMs?: () => number
}): {
  deps: PrepareCodexAccountSwitchResumeDeps
  calls: RecordedCall[]
  bridgedHomes: CodexAccountSwitchHomes[]
} {
  const { runner, calls } = createFakeSessionRunner(args.script)
  const bridgedHomes: CodexAccountSwitchHomes[] = []
  return {
    deps: {
      resolveHomes: () => ({ outcome: 'homes', homes: args.homes ?? CROSS_HOME }),
      ensureRolloutBridged: async (homes) => {
        bridgedHomes.push(homes)
        return args.bridged ?? true
      },
      runAppServerSession: runner,
      buildInvocation: (codexHomePath, timeoutMs) => ({
        command: 'codex',
        args: ['app-server'],
        env: { CODEX_HOME: codexHomePath },
        timeoutMs
      }),
      capabilityCache: args.cache ?? new CodexAppServerCapabilityCache(),
      ...(args.nowMs ? { nowMs: args.nowMs } : {})
    },
    calls,
    bridgedHomes
  }
}

const GOAL = {
  threadId: THREAD_ID,
  objective: 'ship the fix',
  status: 'usageLimited',
  tokenBudget: 250_000,
  tokensUsed: 1000,
  timeUsedSeconds: 60,
  createdAt: 1,
  updatedAt: 2
}

describe('prepareCodexAccountSwitchResume', () => {
  it('reads the goal from the old home and writes it after thread/read in the new home', async () => {
    const { deps, calls, bridgedHomes } = prepareDeps({
      script: (call) => (call.method === 'thread/goal/get' ? { goal: GOAL } : {})
    })

    const decision = await prepareCodexAccountSwitchResume({ threadId: THREAD_ID }, deps)

    expect(decision).toEqual({ outcome: 'resume', threadId: THREAD_ID })
    expect(bridgedHomes).toEqual([CROSS_HOME])
    expect(calls).toEqual([
      { home: OLD_HOME, method: 'thread/goal/get', params: { threadId: THREAD_ID } },
      { home: NEW_HOME, method: 'thread/read', params: { threadId: THREAD_ID } },
      {
        home: NEW_HOME,
        method: 'thread/goal/set',
        params: {
          threadId: THREAD_ID,
          objective: 'ship the fix',
          status: 'usageLimited',
          tokenBudget: 250_000
        }
      }
    ])
  })

  it('clears a stale target goal when the source thread is goalless', async () => {
    const { deps, calls } = prepareDeps({
      script: (call) => (call.method === 'thread/goal/get' ? { goal: null } : {})
    })

    const decision = await prepareCodexAccountSwitchResume({ threadId: THREAD_ID }, deps)

    expect(decision).toEqual({ outcome: 'resume', threadId: THREAD_ID })
    expect(calls).toEqual([
      { home: OLD_HOME, method: 'thread/goal/get', params: { threadId: THREAD_ID } },
      { home: NEW_HOME, method: 'thread/read', params: { threadId: THREAD_ID } },
      { home: NEW_HOME, method: 'thread/goal/clear', params: { threadId: THREAD_ID } }
    ])
  })

  it('normalizes a missing token budget to null for the write', async () => {
    const { deps, calls } = prepareDeps({
      script: (call) =>
        call.method === 'thread/goal/get' ? { goal: { ...GOAL, tokenBudget: undefined } } : {}
    })

    await prepareCodexAccountSwitchResume({ threadId: THREAD_ID }, deps)

    expect(calls.at(-1)?.params).toMatchObject({ tokenBudget: null })
  })

  it('resumes immediately without app-server work when both homes are the same', async () => {
    const cache = new CodexAppServerCapabilityCache()
    cache.rememberUnsupported(CODEX_GOAL_RPC_HOST_KEY, 1_000)
    const { deps, calls, bridgedHomes } = prepareDeps({
      script: () => {
        throw new Error('same-home restart must not spawn an app-server')
      },
      homes: { oldCodexHomePath: OLD_HOME, newCodexHomePath: OLD_HOME },
      cache,
      nowMs: () => 1_001
    })

    const decision = await prepareCodexAccountSwitchResume({ threadId: THREAD_ID }, deps)

    // Why: one home means one goals DB and one rollout tree; resume carries both.
    expect(decision).toEqual({ outcome: 'resume', threadId: THREAD_ID })
    expect(bridgedHomes).toEqual([])
    expect(calls).toEqual([])
  })

  it('declines a thread id that is not a bare rollout UUID without touching anything', async () => {
    const { deps, calls } = prepareDeps({ script: () => ({}) })

    const decision = await prepareCodexAccountSwitchResume({ threadId: '$(rm -rf ~); echo' }, deps)

    expect(decision).toEqual({ outcome: 'fresh', reason: 'invalid-thread-id' })
    expect(calls).toEqual([])
  })

  it('passes a homes decline through untouched', async () => {
    const { deps, calls } = prepareDeps({ script: () => ({}) })
    deps.resolveHomes = () => ({ outcome: 'fresh', reason: 'non-host-lane' })

    expect(await prepareCodexAccountSwitchResume({ threadId: THREAD_ID }, deps)).toEqual({
      outcome: 'fresh',
      reason: 'non-host-lane'
    })
    expect(calls).toEqual([])
  })

  it('declines when the rollout cannot be bridged, before any new-home RPC', async () => {
    const { deps, calls } = prepareDeps({
      script: () => ({ goal: GOAL }),
      bridged: false
    })

    const decision = await prepareCodexAccountSwitchResume({ threadId: THREAD_ID }, deps)

    expect(decision).toEqual({ outcome: 'fresh', reason: 'rollout-not-bridged' })
    expect(calls.map((call) => call.method)).toEqual(['thread/goal/get'])
  })

  it.each([
    ['thread/read', 'thread/read'],
    ['thread/goal/set', 'thread/goal/set']
  ])('declines when %s fails in the new home', async (_label, failingMethod) => {
    const { deps } = prepareDeps({
      script: (call) => {
        if (call.method === failingMethod) {
          throw new Error(`codex app-server ${failingMethod} failed: boom`)
        }
        return call.method === 'thread/goal/get' ? { goal: GOAL } : {}
      }
    })

    expect(await prepareCodexAccountSwitchResume({ threadId: THREAD_ID }, deps)).toEqual({
      outcome: 'fresh',
      reason: 'goal-write-failed'
    })
  })

  it('declines when clearing a stale target goal fails', async () => {
    const { deps } = prepareDeps({
      script: (call) => {
        if (call.method === 'thread/goal/clear') {
          throw new Error('codex app-server thread/goal/clear failed: boom')
        }
        return call.method === 'thread/goal/get' ? { goal: null } : {}
      }
    })

    expect(await prepareCodexAccountSwitchResume({ threadId: THREAD_ID }, deps)).toEqual({
      outcome: 'fresh',
      reason: 'goal-write-failed'
    })
  })

  it('declines on an unrecognizable goal payload instead of guessing', async () => {
    const { deps } = prepareDeps({
      script: () => ({ goal: { status: 'usageLimited' } })
    })

    expect(await prepareCodexAccountSwitchResume({ threadId: THREAD_ID }, deps)).toEqual({
      outcome: 'fresh',
      reason: 'goal-shape-unexpected'
    })
  })

  it('declines a goal response that omits the goal property', async () => {
    const { deps, calls } = prepareDeps({ script: () => ({}) })

    expect(await prepareCodexAccountSwitchResume({ threadId: THREAD_ID }, deps)).toEqual({
      outcome: 'fresh',
      reason: 'goal-shape-unexpected'
    })
    expect(calls.map((call) => call.method)).toEqual(['thread/goal/get'])
  })

  it('treats a transient read failure as fresh without poisoning the capability', async () => {
    const cache = new CodexAppServerCapabilityCache()
    const { deps } = prepareDeps({
      script: () => {
        throw new Error('spawn ENOENT')
      },
      cache
    })

    expect(await prepareCodexAccountSwitchResume({ threadId: THREAD_ID }, deps)).toEqual({
      outcome: 'fresh',
      reason: 'goal-read-failed'
    })
    expect(cache.shouldTry(CODEX_GOAL_RPC_HOST_KEY)).toBe(true)
  })

  describe('capability gate', () => {
    it('remembers an unsupported CLI and stops probing until the retry interval', async () => {
      const cache = new CodexAppServerCapabilityCache()
      let now = 1_000
      const { deps, calls } = prepareDeps({
        script: () => {
          throw new CodexAppServerUnsupportedError('thread/goal/get: method not found')
        },
        cache,
        nowMs: () => now
      })

      expect(await prepareCodexAccountSwitchResume({ threadId: THREAD_ID }, deps)).toEqual({
        outcome: 'fresh',
        reason: 'goal-rpc-unsupported'
      })
      expect(calls).toHaveLength(1)

      // Second attempt inside the interval never spawns an app-server.
      expect(await prepareCodexAccountSwitchResume({ threadId: THREAD_ID }, deps)).toEqual({
        outcome: 'fresh',
        reason: 'goal-rpc-unsupported'
      })
      expect(calls).toHaveLength(1)

      // Why: an in-place codex upgrade must self-heal after the interval.
      now += 31 * 60_000
      await prepareCodexAccountSwitchResume({ threadId: THREAD_ID }, deps)
      expect(calls).toHaveLength(2)
    })

    it('marks the capability supported after a successful goal read', async () => {
      const cache = new CodexAppServerCapabilityCache()
      const { deps } = prepareDeps({ script: () => ({ goal: null }), cache })

      await prepareCodexAccountSwitchResume({ threadId: THREAD_ID }, deps)

      expect(cache.isKnownSupported(CODEX_GOAL_RPC_HOST_KEY)).toBe(true)
    })
  })
})
