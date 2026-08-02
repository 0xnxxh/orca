import { normalizeRuntimePathForComparison } from '../../shared/cross-platform-path'
import type { GlobalSettings } from '../../shared/types'
import { assertOwnedHostCodexManagedHomePath } from '../codex-accounts/host-codex-managed-home-ownership'
import { getCodexSelectionTargetForAccount } from '../codex-accounts/runtime-selection'
import { resolveCodexCommand } from '../codex-cli/command'
import { getSpawnArgsForWindows } from '../win32-utils'
import { ensureCodexRolloutBridgedIntoAccountHome } from './codex-account-session-bridge'
import { CodexAppServerCapabilityCache } from './codex-app-server-capability-cache'
import {
  isCodexAppServerUnsupportedError,
  runCodexAppServerSession,
  type CodexAppServerInvocation
} from './codex-app-server-session'
import { getSystemCodexHomePath, resolveOrcaManagedCodexHomePath } from './codex-home-paths'
import { getCodexPaneAccount, type CodexPaneAccountRecord } from './codex-pane-account-registry'

// Why: an account-switch restart used to always start a brand-new Codex thread,
// which stranded the pane's /goal — Codex keys thread_goals by thread id inside
// the launch CODEX_HOME's sqlite, so the goal became doubly unreachable (new
// thread, other home). This module decides whether the restarted pane may
// `codex resume` its live thread instead, and carries the goal row across homes
// through the sanctioned app-server RPCs (thread/goal/get → thread/goal/set).
// Orca never reads or writes Codex's sqlite itself: the app-server owns the DB
// and its WAL. Any doubt — unrecorded pane, non-host lane, custom home, missing
// rollout, old CLI without the goal RPCs — degrades to today's fresh `codex`
// startup, because resuming the wrong session is worse than losing the goal.

const CODEX_THREAD_ID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

const GOAL_READ_TIMEOUT_MS = 10_000
const GOAL_WRITE_TIMEOUT_MS = 15_000

/** Goal RPCs are probed on the native host only; WSL/remote lanes never reach
 *  the probe (their panes degrade to a fresh startup in resolveHomes). */
export const CODEX_GOAL_RPC_HOST_KEY = 'native' as const

/** Separate cache from the trust-grant pair: the goal RPCs shipped later, so a
 *  CLI can support one surface and not the other. */
export const codexGoalRpcCapabilityCache = new CodexAppServerCapabilityCache()

export type CodexAccountSwitchResumeDecision =
  | { outcome: 'resume'; threadId: string }
  | { outcome: 'fresh'; reason: string }

export type CodexAccountSwitchHomes = {
  oldCodexHomePath: string
  newCodexHomePath: string
}

export type CodexAccountSwitchHomesDecision =
  | { outcome: 'homes'; homes: CodexAccountSwitchHomes }
  | { outcome: 'fresh'; reason: string }

type CodexThreadGoalSnapshot = {
  objective: string
  status: string
  tokenBudget: number | null
}

/**
 * Resolves the CODEX_HOME the pane launched under and the one the restart will
 * inject, from the pane-account registry record and the current host selection.
 *
 * Declines (fresh) whenever either home cannot be named with certainty: the
 * record is what the spawn actually resolved, so nothing here re-derives from
 * live settings except the new selection itself.
 */
export function resolveCodexAccountSwitchHomes(args: {
  record: CodexPaneAccountRecord | null
  settings: Pick<GlobalSettings, 'codexManagedAccounts'>
  managedAccountsRoot: string
  systemCodexHomePath: string
  sharedRuntimeCodexHomePath: string
  selectedHostAccountCodexHomePath: string | null
  hostSystemDefaultRealHome: boolean
  assertOwnedManagedHome?: typeof assertOwnedHostCodexManagedHomePath
}): CodexAccountSwitchHomesDecision {
  const record = args.record
  if (!record) {
    return { outcome: 'fresh', reason: 'pane-launch-unrecorded' }
  }
  if (record.selectionKey !== 'host') {
    return { outcome: 'fresh', reason: 'non-host-lane' }
  }
  // Why: an observed override means the shell, not Orca, picked the launch
  // home — the same shell can redirect the restarted spawn too, so neither
  // side of the bridge can be predicted.
  if (record.shellStartupHomeOverride || record.environmentHomeOverride) {
    return { outcome: 'fresh', reason: 'custom-home-override' }
  }
  const oldHome = resolveRecordedLaunchHome(args, record)
  if (oldHome.outcome === 'fresh') {
    return oldHome
  }
  const newCodexHomePath =
    args.selectedHostAccountCodexHomePath ??
    (args.hostSystemDefaultRealHome ? args.systemCodexHomePath : args.sharedRuntimeCodexHomePath)
  return {
    outcome: 'homes',
    homes: { oldCodexHomePath: oldHome.path, newCodexHomePath }
  }
}

function resolveRecordedLaunchHome(
  args: {
    settings: Pick<GlobalSettings, 'codexManagedAccounts'>
    managedAccountsRoot: string
    systemCodexHomePath: string
    sharedRuntimeCodexHomePath: string
    assertOwnedManagedHome?: typeof assertOwnedHostCodexManagedHomePath
  },
  record: CodexPaneAccountRecord
): { outcome: 'home'; path: string } | { outcome: 'fresh'; reason: string } {
  switch (record.homeRoute) {
    case 'real-home':
      return { outcome: 'home', path: args.systemCodexHomePath }
    case 'shared-home':
      return { outcome: 'home', path: args.sharedRuntimeCodexHomePath }
    case 'account-home': {
      const account = args.settings.codexManagedAccounts?.find(
        (candidate) =>
          candidate.id === record.accountId &&
          getCodexSelectionTargetForAccount(candidate).runtime === 'host'
      )
      if (!account) {
        return { outcome: 'fresh', reason: 'launch-account-removed' }
      }
      try {
        ;(args.assertOwnedManagedHome ?? assertOwnedHostCodexManagedHomePath)({
          candidatePath: account.managedHomePath,
          managedAccountsRoot: args.managedAccountsRoot,
          systemCodexHomePath: args.systemCodexHomePath,
          expectedAccountId: account.id
        })
      } catch {
        return { outcome: 'fresh', reason: 'untrusted-managed-home' }
      }
      return { outcome: 'home', path: account.managedHomePath }
    }
    // Why: a custom CODEX_HOME lives outside Orca's management, and a record
    // without route provenance predates it entirely — neither names a home.
    case 'custom-home':
    case 'wsl-home':
    case undefined:
      return { outcome: 'fresh', reason: 'unattributable-home-route' }
  }
}

export type PrepareCodexAccountSwitchResumeDeps = {
  resolveHomes: () => CodexAccountSwitchHomesDecision
  /** Guarantees the thread's rollout is linked under the new home before Orca
   *  commits to `codex resume`; false drops the resume. */
  ensureRolloutBridged: (homes: CodexAccountSwitchHomes) => Promise<boolean>
  runAppServerSession?: typeof runCodexAppServerSession
  buildInvocation?: (codexHomePath: string, timeoutMs: number) => CodexAppServerInvocation
  capabilityCache?: CodexAppServerCapabilityCache
  nowMs?: () => number
}

/**
 * Decides whether an account-switch restart may resume the pane's thread, and
 * performs the goal bridge as part of deciding: `resume` is only answered once
 * the rollout is present in the new home, `thread/read` proved it resumable
 * there, and any goal row was written through `thread/goal/set`.
 */
export async function prepareCodexAccountSwitchResume(
  request: { threadId: string },
  deps: PrepareCodexAccountSwitchResumeDeps
): Promise<CodexAccountSwitchResumeDecision> {
  const { threadId } = request
  if (!CODEX_THREAD_ID_PATTERN.test(threadId)) {
    return { outcome: 'fresh', reason: 'invalid-thread-id' }
  }
  const homesDecision = deps.resolveHomes()
  if (homesDecision.outcome === 'fresh') {
    return homesDecision
  }
  const { homes } = homesDecision
  const cache = deps.capabilityCache ?? codexGoalRpcCapabilityCache
  const nowMs = deps.nowMs ?? ((): number => Date.now())
  if (
    !cache.isKnownSupported(CODEX_GOAL_RPC_HOST_KEY) &&
    !cache.shouldTry(CODEX_GOAL_RPC_HOST_KEY, nowMs())
  ) {
    return { outcome: 'fresh', reason: 'goal-rpc-unsupported' }
  }
  const runSession = deps.runAppServerSession ?? runCodexAppServerSession
  const buildInvocation = deps.buildInvocation ?? buildCodexGoalRpcInvocation

  let goal: CodexThreadGoalSnapshot | null
  try {
    // Why: the get doubles as the capability probe — a method-not-found reply or
    // a missing app-server subcommand is the only signal that marks unsupported.
    const result = await runSession(
      buildInvocation(homes.oldCodexHomePath, GOAL_READ_TIMEOUT_MS),
      (rpc) => rpc.request('thread/goal/get', { threadId })
    )
    const parsed = parseThreadGoalSnapshot(result)
    if (parsed.outcome === 'malformed') {
      return { outcome: 'fresh', reason: 'goal-shape-unexpected' }
    }
    goal = parsed.goal
    cache.rememberSupported(CODEX_GOAL_RPC_HOST_KEY)
  } catch (error) {
    if (isCodexAppServerUnsupportedError(error)) {
      cache.rememberUnsupported(CODEX_GOAL_RPC_HOST_KEY, nowMs())
      return { outcome: 'fresh', reason: 'goal-rpc-unsupported' }
    }
    return { outcome: 'fresh', reason: 'goal-read-failed' }
  }

  if (
    normalizeRuntimePathForComparison(homes.oldCodexHomePath) ===
    normalizeRuntimePathForComparison(homes.newCodexHomePath)
  ) {
    // Same home keeps the same goals DB and rollout tree; resume alone carries both.
    return { outcome: 'resume', threadId }
  }

  if (!(await deps.ensureRolloutBridged(homes))) {
    return { outcome: 'fresh', reason: 'rollout-not-bridged' }
  }

  try {
    await runSession(
      buildInvocation(homes.newCodexHomePath, GOAL_WRITE_TIMEOUT_MS),
      async (rpc) => {
        // Why: thread/read is Codex's sanctioned lazy indexing — it parses the
        // bridged rollout and upserts the thread row, proving the thread is
        // resumable in this home before Orca commits the pane to `codex resume`.
        await rpc.request('thread/read', { threadId })
        if (goal) {
          await rpc.request('thread/goal/set', {
            threadId,
            objective: goal.objective,
            status: goal.status,
            tokenBudget: goal.tokenBudget
          })
        }
      }
    )
  } catch (error) {
    if (isCodexAppServerUnsupportedError(error)) {
      cache.rememberUnsupported(CODEX_GOAL_RPC_HOST_KEY, nowMs())
    }
    console.warn('[codex-account-switch-resume] Goal bridge into new home failed:', error)
    return { outcome: 'fresh', reason: 'goal-write-failed' }
  }
  return { outcome: 'resume', threadId }
}

/** Tolerates future status values on purpose: both homes run the same codex
 *  binary, so whatever the old home reported the new home can store. */
function parseThreadGoalSnapshot(
  result: unknown
): { outcome: 'parsed'; goal: CodexThreadGoalSnapshot | null } | { outcome: 'malformed' } {
  if (!result || typeof result !== 'object') {
    return { outcome: 'malformed' }
  }
  const goal = (result as { goal?: unknown }).goal
  if (goal === null || goal === undefined) {
    return { outcome: 'parsed', goal: null }
  }
  if (typeof goal !== 'object') {
    return { outcome: 'malformed' }
  }
  const { objective, status, tokenBudget } = goal as Record<string, unknown>
  if (typeof objective !== 'string' || typeof status !== 'string' || status.length === 0) {
    return { outcome: 'malformed' }
  }
  return {
    outcome: 'parsed',
    goal: {
      objective,
      status,
      tokenBudget:
        typeof tokenBudget === 'number' && Number.isFinite(tokenBudget) ? tokenBudget : null
    }
  }
}

function buildCodexGoalRpcInvocation(
  codexHomePath: string,
  timeoutMs: number
): CodexAppServerInvocation {
  const command = resolveCodexCommand()
  const { spawnCmd, spawnArgs } = getSpawnArgsForWindows(command, ['app-server'])
  return {
    command: spawnCmd,
    args: spawnArgs,
    // Why: pin the bridged home explicitly — nested Orca launches can inherit a
    // managed CODEX_HOME, which would read or write the wrong goals DB.
    env: { CODEX_HOME: codexHomePath },
    timeoutMs
  }
}

/**
 * IPC-facing wiring: assembles the real registry, home and bridge dependencies
 * for one pane's restart. Kept apart from the decision logic so tests can fake
 * every seam.
 */
export async function prepareCodexAccountSwitchResumeForPane(args: {
  ptyId: string
  threadId: string
  transcriptPath?: string
  settings: GlobalSettings
  managedAccountsRoot: string
  selectedHostAccountCodexHomePath: string | null
  hostSystemDefaultRealHome: boolean
}): Promise<CodexAccountSwitchResumeDecision> {
  return prepareCodexAccountSwitchResume(
    { threadId: args.threadId },
    {
      resolveHomes: () =>
        resolveCodexAccountSwitchHomes({
          record: getCodexPaneAccount(args.ptyId),
          settings: args.settings,
          managedAccountsRoot: args.managedAccountsRoot,
          systemCodexHomePath: getSystemCodexHomePath(),
          sharedRuntimeCodexHomePath: resolveOrcaManagedCodexHomePath(),
          selectedHostAccountCodexHomePath: args.selectedHostAccountCodexHomePath,
          hostSystemDefaultRealHome: args.hostSystemDefaultRealHome
        }),
      ensureRolloutBridged: async (homes) =>
        (await ensureCodexRolloutBridgedIntoAccountHome({
          threadId: args.threadId,
          ...(args.transcriptPath ? { transcriptPath: args.transcriptPath } : {}),
          sourceCodexHomePath: homes.oldCodexHomePath,
          targetCodexHomePath: homes.newCodexHomePath
        })) !== null
    }
  )
}
